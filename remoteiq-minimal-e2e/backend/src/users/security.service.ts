import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { createHash } from "crypto";
import { PgPoolService } from "../storage/pg-pool.service";

const PASSWORD_MIN_LEN = parseInt(process.env.PASSWORD_MIN_LEN || "8", 10) || 8;
const TOTP_ISSUER = process.env.TOTP_ISSUER || "RemoteIQ";
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_ATTEMPTS = 5;
const TOTP_WINDOW = parseInt(process.env.TOTP_WINDOW || "1", 10) || 1;

type SessionRow = {
    id: string;
    user_id: string;
    user_agent: string | null;
    ip_address: string | null;
    created_at: string;
    last_seen_at: string;
    revoked_at: string | null;
    trusted: boolean | null;
};

type TokenRow = {
    id: string;
    user_id: string;
    description: string | null;
    token_hash: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
};

const rateMap = new Map<string, number[]>();
function checkRate(key: string) {
    const now = Date.now();
    const arr = (rateMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (arr.length >= RATE_MAX_ATTEMPTS) {
        throw new HttpException("Too many attempts, slow down.", HttpStatus.TOO_MANY_REQUESTS);
    }
    arr.push(now);
    rateMap.set(key, arr);
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class SecurityService {
    constructor(@Inject(PgPoolService) private readonly pg: PgPoolService) {
        authenticator.options = { window: TOTP_WINDOW };
    }

    /* ------------------------- Password ------------------------- */
    async changePassword(userId: string, current: string, next: string) {
        checkRate(`pw:${userId}`);
        if (!next || next.length < PASSWORD_MIN_LEN) {
            throw new HttpException(
                `Password must be at least ${PASSWORD_MIN_LEN} characters.`,
                HttpStatus.BAD_REQUEST,
            );
        }
        if (current === next) {
            throw new HttpException("New password must differ from current.", HttpStatus.BAD_REQUEST);
        }

        const { rows } = await this.pg.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
        if (rows.length === 0) throw new HttpException("User not found.", HttpStatus.NOT_FOUND);

        const ok = await bcrypt.compare(current, (rows[0] as any).password_hash);
        if (!ok) throw new HttpException("Current password is incorrect.", HttpStatus.FORBIDDEN);

        const newHash = await bcrypt.hash(next, 12);
        await this.pg.query(
            "UPDATE users SET password_hash = $1 WHERE id = $2",
            [newHash, userId],
        );
        await this.pg.query(
            `INSERT INTO user_security (user_id, password_changed_at)
             VALUES ($1, now())
             ON CONFLICT (user_id) DO UPDATE
               SET password_changed_at = EXCLUDED.password_changed_at`,
            [userId],
        );
        return true;
    }

    /* ------------------------- 2FA (TOTP) ------------------------- */

    async start2fa(userId: string, email: string) {
        checkRate(`2fa:start:${userId}`);

        const secret = authenticator.generateSecret();
        const label = encodeURIComponent(email);
        const issuer = encodeURIComponent(TOTP_ISSUER);
        const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
        const qrPngDataUrl = await QRCode.toDataURL(otpauthUrl);

        await this.pg.query(
            `INSERT INTO user_security (user_id, two_factor_enabled, totp_secret, recovery_codes)
             VALUES ($1, false, $2, '{}'::text[])
             ON CONFLICT (user_id) DO UPDATE
               SET totp_secret = EXCLUDED.totp_secret,
                   two_factor_enabled = false,
                   recovery_codes = COALESCE(user_security.recovery_codes, '{}'::text[])`,
            [userId, secret],
        );

        return { secret, otpauthUrl, qrPngDataUrl };
    }

    async confirm2fa(userId: string, code: string) {
        checkRate(`2fa:confirm:${userId}`);

        const { rows } = await this.pg.query(
            `SELECT totp_secret FROM user_security WHERE user_id = $1 LIMIT 1`,
            [userId],
        );
        if (!rows.length) throw new HttpException("Start 2FA first.", HttpStatus.BAD_REQUEST);

        const secret = (rows[0] as any).totp_secret as string | null;
        if (!secret) throw new HttpException("Start 2FA first.", HttpStatus.BAD_REQUEST);

        const token = (code || "").replace(/\D/g, "").slice(-6);
        if (token.length !== 6) {
            throw new HttpException("Invalid TOTP code.", HttpStatus.BAD_REQUEST);
        }

        const valid = authenticator.verify({ token, secret });
        if (!valid) throw new HttpException("Invalid TOTP code.", HttpStatus.BAD_REQUEST);

        const recoveryCodes = this.generateRecoveryCodes(8);
        const hashedCodes = recoveryCodes.map((c) => sha256Hex(c.toLowerCase()));

        await this.pg.query(
            `UPDATE user_security
                SET two_factor_enabled = true,
                    recovery_codes = $2
              WHERE user_id = $1`,
            [userId, hashedCodes],
        );

        return recoveryCodes;
    }

    async disable2fa(userId: string, code?: string, recoveryCode?: string) {
        checkRate(`2fa:disable:${userId}`);

        const { rows } = await this.pg.query(
            `SELECT totp_secret, two_factor_enabled, recovery_codes
               FROM user_security
              WHERE user_id = $1
              LIMIT 1`,
            [userId],
        );
        if (!rows.length) {
            await this.pg.query(
                `INSERT INTO user_security (user_id, two_factor_enabled, recovery_codes, totp_secret)
                 VALUES ($1, false, '{}'::text[], NULL)
                 ON CONFLICT (user_id) DO NOTHING`,
                [userId],
            );
            return;
        }

        const row = rows[0] as any;
        if (!row.two_factor_enabled) {
            await this.pg.query(
                `UPDATE user_security
                    SET two_factor_enabled = false,
                        totp_secret = NULL,
                        recovery_codes = '{}'::text[]
                  WHERE user_id = $1`,
                [userId],
            );
            return;
        }

        let ok = false;
        if (!ok && code && row.totp_secret) {
            const token = String(code).replace(/\D/g, "").slice(-6);
            if (token.length === 6) ok = authenticator.verify({ token, secret: row.totp_secret });
        }

        if (!ok && recoveryCode) {
            const list: string[] = Array.isArray(row.recovery_codes) ? row.recovery_codes : [];
            const hashed = sha256Hex(recoveryCode.trim().toLowerCase());
            const idx = list.findIndex((c) => c === hashed);
            if (idx >= 0) {
                ok = true;
                list.splice(idx, 1);
                await this.pg.query(
                    `UPDATE user_security SET recovery_codes = $1 WHERE user_id = $2`,
                    [list, userId],
                );
            }
        }

        if (!ok) throw new HttpException("Invalid code or recovery code.", HttpStatus.FORBIDDEN);

        await this.pg.query(
            `UPDATE user_security
                SET two_factor_enabled = false,
                    totp_secret = NULL,
                    recovery_codes = '{}'::text[]
              WHERE user_id = $1`,
            [userId],
        );
    }

    async regenerateRecoveryCodes(userId: string) {
        checkRate(`2fa:regen:${userId}`);

        const { rows } = await this.pg.query(
            `SELECT two_factor_enabled FROM user_security WHERE user_id = $1 LIMIT 1`,
            [userId],
        );
        if (!rows.length || !(rows[0] as any).two_factor_enabled) {
            throw new HttpException("Enable 2FA first.", HttpStatus.BAD_REQUEST);
        }

        const codes = this.generateRecoveryCodes(8);
        const hashed = codes.map((c) => sha256Hex(c.toLowerCase()));
        await this.pg.query(
            `UPDATE user_security SET recovery_codes = $1 WHERE user_id = $2`,
            [hashed, userId],
        );
        return codes;
    }

    private generateRecoveryCodes(n: number): string[] {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
        const code = () => `${part()}-${part()}-${part()}`;
        return Array.from({ length: n }, code);
    }

    /* ------------------------- Sessions ------------------------- */

    async listSessions(userId: string, currentSessionId?: string) {
        const { rows } = await this.pg.query<SessionRow>(
            `SELECT id, user_id, user_agent, ip_address::text AS ip_address, created_at, last_seen_at, revoked_at, trusted
               FROM sessions
              WHERE user_id = $1
                AND revoked_at IS NULL
              ORDER BY last_seen_at DESC, created_at DESC`,
            [userId],
        );

        const items = rows.map((r) => ({
            id: r.id,
            createdAt: r.created_at,
            lastSeenAt: r.last_seen_at,
            ip: r.ip_address,
            userAgent: r.user_agent || "",
            current: currentSessionId ? String(r.id) === String(currentSessionId) : false,
            revokedAt: undefined,
            trusted: !!r.trusted,
        }));
        return { items, currentJti: currentSessionId || "" };
    }

    async setSessionTrust(userId: string, sessionId: string, trusted: boolean) {
        const { rows } = await this.pg.query(
            `UPDATE sessions
                SET trusted = $3
              WHERE id = $1
                AND user_id = $2
                AND revoked_at IS NULL
            RETURNING id`,
            [sessionId, userId, !!trusted],
        );
        if (!rows.length) throw new HttpException("Session not found.", HttpStatus.NOT_FOUND);
        return { trusted: !!trusted };
    }

    async revokeSession(userId: string, sessionId: string, currentSessionId?: string) {
        if (currentSessionId && String(sessionId) === String(currentSessionId)) {
            throw new HttpException("You cannot revoke your current session.", HttpStatus.BAD_REQUEST);
        }
        const { rows } = await this.pg.query(
            `UPDATE sessions
                SET revoked_at = now()
              WHERE id = $1
                AND user_id = $2
                AND revoked_at IS NULL
            RETURNING id`,
            [sessionId, userId],
        );
        if (!rows.length) throw new HttpException("Session not found.", HttpStatus.NOT_FOUND);
    }

    async revokeAllOtherSessions(userId: string, currentSessionId?: string) {
        if (currentSessionId) {
            await this.pg.query(
                `UPDATE sessions
                    SET revoked_at = now()
                  WHERE user_id = $1
                    AND revoked_at IS NULL
                    AND id::text <> $2`,
                [userId, String(currentSessionId)],
            );
        } else {
            await this.pg.query(
                `UPDATE sessions
                    SET revoked_at = now()
                  WHERE user_id = $1
                    AND revoked_at IS NULL`,
                [userId],
            );
        }
    }

    /* ------------------------- Personal Tokens ------------------------- */

    async listTokens(userId: string) {
        const { rows } = await this.pg.query<TokenRow>(
            `SELECT id, user_id, description, token_hash, created_at, last_used_at, expires_at, revoked_at
               FROM personal_access_tokens
              WHERE user_id = $1
              ORDER BY created_at DESC`,
            [userId],
        );
        return {
            items: rows.map((r) => ({
                id: r.id,
                name: r.description || "",
                createdAt: r.created_at,
                lastUsedAt: r.last_used_at || undefined,
                revokedAt: r.revoked_at || undefined,
            })),
        };
    }

    async createToken(userId: string, name: string) {
        checkRate(`pat:${userId}`);
        if (!name?.trim()) {
            throw new HttpException("Name is required.", HttpStatus.BAD_REQUEST);
        }
        const tokenPlain = this.randomToken();
        const tokenHash = await bcrypt.hash(tokenPlain, 12);
        const ins = await this.pg.query<{ id: string }>(
            `INSERT INTO personal_access_tokens (user_id, description, token_hash)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [userId, name.trim(), tokenHash],
        );
        return { token: tokenPlain, id: ins.rows[0].id };
    }

    async revokeToken(userId: string, id: string) {
        const { rows } = await this.pg.query(
            `UPDATE personal_access_tokens
                SET revoked_at = now()
              WHERE id = $1 AND user_id = $2
            RETURNING id`,
            [id, userId],
        );
        if (!rows.length) throw new HttpException("Token not found.", HttpStatus.NOT_FOUND);
    }

    private randomToken() {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
        return Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    }

    /* ------------------------- Overview ------------------------- */

    async securityOverview(userId: string, currentSessionId?: string) {
        const { rows } = await this.pg.query(
            `SELECT two_factor_enabled FROM user_security WHERE user_id = $1 LIMIT 1`,
            [userId],
        );
        const twoFactorEnabled = !!rows[0]?.two_factor_enabled;
        const sess = await this.listSessions(userId, currentSessionId);
        const events = (sess.items || []).slice(0, 10).map((s: any) => ({
            id: s.id,
            type: "signed_in" as const,
            at: s.createdAt,
            ip: s.ip,
            userAgent: s.userAgent,
        }));
        return {
            twoFactorEnabled,
            sessions: sess.items,
            events,
        };
    }

    async ensureSecurityRow(userId: string) {
        const { rowCount } = await this.pg.query(
            `INSERT INTO user_security (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId],
        );
        return rowCount;

    }

    /* ------------------------- WebAuthn stubs ------------------------- */

    async webauthnCreateOptions(userId: string, email: string) {
        void userId;
        void email;
        throw new HttpException(
            "WebAuthn registration is not enabled on this deployment.",
            HttpStatus.NOT_IMPLEMENTED,
        );
    }

    async webauthnFinish(userId: string, payload: any) {
        void userId;
        void payload;
        throw new HttpException(
            "WebAuthn registration is not enabled on this deployment.",
            HttpStatus.NOT_IMPLEMENTED,
        );
    }

    async deleteWebAuthn(userId: string, credentialId: string) {
        void userId;
        void credentialId;
        throw new HttpException(
            "WebAuthn registration is not enabled on this deployment.",
            HttpStatus.NOT_IMPLEMENTED,
        );


    }
}
