//remoteiq-minimal-e2e\backend\src\auth\user-auth.service.ts

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PgPoolService } from "../storage/pg-pool.service";
import { OrganizationContextService } from "../storage/organization-context.service";
import { randomUUID, createHash, createHmac } from "crypto";

export type RoleSummary = { id: string; name: string };

type WebUser = {
    id: string;
    organizationId: string;
    email: string;
    name: string | null;
    role: string;
    roles: RoleSummary[];
    permissions: string[];
};

type DbUserRow = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    password_hash: string | null;
    status: string;
    organization_id: string;
    roles: any;
    permissions: string[] | null;
};

type UserSecurityRow = {
    user_id: string;
    two_factor_enabled: boolean | null;
    totp_secret: string | null;
    recovery_codes: string[] | null;
};

@Injectable()
export class UserAuthService {
    constructor(
        private readonly jwt: JwtService,
        private readonly pg: PgPoolService,
        private readonly orgs: OrganizationContextService,
    ) { }

    /** Validate against Postgres users table */
    async validateUser(email: string, password: string): Promise<WebUser> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const row = await this.loadUserByEmail(orgId, email);
        if (!row || row.status !== "active") {
            throw new UnauthorizedException("Invalid email or password");
        }
        if (!row.password_hash) {
            throw new UnauthorizedException("Invalid email or password");
        }

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) throw new UnauthorizedException("Invalid email or password");

        return this.mapDbRowToWebUser(row);
    }

    /** Issue a JWT **with JTI** (uses JwtModule config). */
    async signWithJti(user: WebUser): Promise<{ token: string; jti: string }> {
        const jti = randomUUID();
        const token = await this.jwt.signAsync({
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            org: user.organizationId,
            perms: user.permissions,
            roles: user.roles.map((r) => r.name),
            jti,
        });
        return { token, jti };
    }

    /** Back-compat signer without JTI (not used by login anymore) */
    async sign(user: WebUser): Promise<string> {
        return this.jwt.signAsync({
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            org: user.organizationId,
            perms: user.permissions,
            roles: user.roles.map((r) => r.name),
        });
    }

    /** Verify cookie token and re-hydrate a minimal user */
    async verify(token: string): Promise<WebUser | null> {
        try {
            const payload = await this.jwt.verifyAsync<{
                sub: string;
                email: string;
                name?: string;
                role: string;
            }>(token, { secret: process.env.JWT_SECRET ?? "dev-secret" });
            const row = await this.loadUserById(payload.sub);
            if (!row || row.status !== "active") return null;
            return this.mapDbRowToWebUser(row);
        } catch {
            return null;
        }
    }

    /** Record a session row keyed by JTI (upsert on jti). */
    async recordSessionOnLogin(userId: string, jti: string, ua?: string, ip?: string) {
        await this.pg.query(
            `
      INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address)
      VALUES ($2, $1, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE
         SET last_seen_at = now(),
             user_agent   = COALESCE(EXCLUDED.user_agent, sessions.user_agent),
             ip_address   = COALESCE(EXCLUDED.ip_address, sessions.ip_address),
             refresh_token = EXCLUDED.refresh_token
      `,
            [userId, jti, jti, ua || null, ip || null],
        );
    }

    // =============== 2FA: feature toggles & device trust =================

    async isTwoFactorEnabled(userId: string): Promise<boolean> {
        try {
            const { rows } = await this.pg.query<{ enabled: boolean }>(
                `
      SELECT
        COALESCE(two_factor_enabled, false)
        AND (totp_secret IS NOT NULL AND length(trim(totp_secret)) > 0)
        AS enabled
      FROM user_security
      WHERE user_id = $1
      LIMIT 1
      `,
                [userId],
            );
            return !!rows[0]?.enabled;
        } catch (e: any) {
            if (e?.code === "42P01" || e?.code === "42703") return false;
            throw e;
        }
    }

    async isDeviceTrusted(userId: string, deviceFingerprint: string | null): Promise<boolean> {
        if (!deviceFingerprint) return false;
        try {
            const { rows } = await this.pg.query(
                `SELECT 1
           FROM trusted_devices
          WHERE user_id = $1
            AND device_fingerprint = $2
            AND last_seen_at > now() - interval '90 days'
          LIMIT 1`,
                [userId, deviceFingerprint],
            );
            return !!rows[0];
        } catch {
            return false;
        }
    }

    async trustCurrentDevice(userId: string, deviceFingerprint: string) {
        try {
            await this.pg.query(`DELETE FROM trusted_devices WHERE user_id = $1 AND device_fingerprint = $2`, [
                userId,
                deviceFingerprint,
            ]);
            await this.pg.query(
                `INSERT INTO trusted_devices (user_id, device_fingerprint)
         VALUES ($1, $2)`,
                [userId, deviceFingerprint],
            );
        } catch {
            // ignore if table not present
        }
    }

    // =============== 2FA: challenge token (short-lived) ==================

    async createChallengeToken(userId: string): Promise<{ token: string; jti: string }> {
        const jti = randomUUID();
        const token = await this.jwt.signAsync(
            { sub: userId, typ: "2fa_challenge", jti },
            { expiresIn: "10m" },
        );
        try {
            const hash = this.sha256Hex(token);
            await this.pg.query(
                `INSERT INTO login_challenges (id, user_id, challenge, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')
         ON CONFLICT (id) DO UPDATE
           SET challenge = EXCLUDED.challenge,
               expires_at = EXCLUDED.expires_at,
               consumed_at = NULL`,
                [jti, userId, hash],
            );
        } catch {
            // ignore if table not present
        }
        return { token, jti };
    }

    async verifyChallengeToken(challengeToken: string): Promise<{ userId: string; jti: string }> {
        let decoded: any;
        try {
            decoded = await this.jwt.verifyAsync(challengeToken);
        } catch {
            throw new UnauthorizedException("Invalid or expired challenge");
        }
        if (!decoded?.sub || decoded?.typ !== "2fa_challenge" || !decoded?.jti) {
            throw new UnauthorizedException("Invalid challenge");
        }

        try {
            const tokenHash = this.sha256Hex(challengeToken);
            const { rows } = await this.pg.query<{
                challenge: string;
                expires_at: string;
                consumed_at: string | null;
            }>(
                `SELECT challenge, expires_at, consumed_at
           FROM login_challenges
          WHERE id = $1 AND user_id = $2
          LIMIT 1`,
                [decoded.jti, decoded.sub],
            );
            const challengeRow = rows[0];
            if (!challengeRow) throw new UnauthorizedException("Invalid challenge");
            if (challengeRow.consumed_at) throw new UnauthorizedException("Challenge already used");
            if (challengeRow.challenge !== tokenHash) throw new UnauthorizedException("Invalid challenge");
            if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
                throw new UnauthorizedException("Challenge expired");
            }
            await this.pg.query(`UPDATE login_challenges SET consumed_at = now() WHERE id = $1`, [decoded.jti]);
        } catch (err) {
            if (err instanceof UnauthorizedException) throw err;
            throw new UnauthorizedException("Invalid challenge");
        }

        return { userId: decoded.sub as string, jti: decoded.jti as string };
    }

    // =============== 2FA: verification (TOTP or recovery) =================

    async verifyTOTP(userId: string, code: string): Promise<boolean> {
        const u = await this.findUserTwoFactor(userId);
        if (!u?.two_factor_enabled || !u.totp_secret) return false;

        const normalized = this.normalizeTotpSecret(u.totp_secret);
        return this.verifyTotpBasic(normalized, code.trim());
    }

    async consumeRecoveryCode(userId: string, recoveryCode: string): Promise<boolean> {
        const u = await this.findUserTwoFactor(userId);
        if (!u) return false;
        const codes = u.recovery_codes || [];
        if (codes.length === 0) return false;

        const candidateHash = this.sha256Hex(recoveryCode.trim().toLowerCase());
        const idx = codes.findIndex((h) => h === candidateHash);
        if (idx === -1) return false;

        const next = [...codes.slice(0, idx), ...codes.slice(idx + 1)];
        await this.pg.query(
            `UPDATE user_security SET recovery_codes = $1 WHERE user_id = $2`,
            [next, userId],
        );
        return true;
    }

    // =============== Lookups =================

    async findUserById(userId: string): Promise<WebUser> {
        const row = await this.loadUserById(userId);
        if (!row || row.status !== "active") {
            throw new UnauthorizedException("User not found");
        }
        return this.mapDbRowToWebUser(row);
    }

    async findUserTwoFactor(userId: string): Promise<UserSecurityRow | null> {
        try {
            const { rows } = await this.pg.query<UserSecurityRow>(
                `SELECT user_id, two_factor_enabled, totp_secret, recovery_codes
           FROM user_security
          WHERE user_id = $1
          LIMIT 1`,
                [userId],
            );
            return rows[0] ?? null;
        } catch (e: any) {
            if (e?.code === "42P01" || e?.code === "42703") return null;
            throw e;
        }
    }

    // =============== Minimal TOTP (robust parsing) =================

    /** Accepts raw base32 or full otpauth:// URI; strips spaces and uppercases */
    private normalizeTotpSecret(input: string): string {
        try {
            if (input.toLowerCase().startsWith("otpauth://")) {
                const u = new URL(input);
                const secret = u.searchParams.get("secret") || "";
                return secret.replace(/\s+/g, "").toUpperCase();
            }
        } catch {
            // not a valid URL; fall through
        }
        return input.replace(/\s+/g, "").toUpperCase();
    }

    private sha256Hex(s: string) {
        return createHash("sha256").update(s).digest("hex");
    }

    private verifyTotpBasic(base32Secret: string, code: string): boolean {
        try {
            const secret = this.base32Decode(base32Secret);
            const step = 30;
            const t = Math.floor(Date.now() / 1000 / step);

            for (const off of [-2, -1, 0, 1, 2]) {
                const counter = Buffer.alloc(8);
                counter.writeBigUInt64BE(BigInt(t + off));
                const hmac = createHmac("sha1", secret).update(counter).digest();
                const offset = hmac[hmac.length - 1] & 0xf;
                const bin =
                    ((hmac[offset] & 0x7f) << 24) |
                    ((hmac[offset + 1] & 0xff) << 16) |
                    ((hmac[offset + 2] & 0xff) << 8) |
                    (hmac[offset + 3] & 0xff);
                const otp = (bin % 1_000_000).toString().padStart(6, "0");
                if (otp === code) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    private base32Decode(b32: string): Buffer {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const clean = b32.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
        let bits = "";
        for (const c of clean) {
            const v = alphabet.indexOf(c);
            if (v < 0) continue;
            bits += v.toString(2).padStart(5, "0");
        }
        const bytes: number[] = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substring(i, i + 8), 2));
        }
        return Buffer.from(bytes);
    }

    private async loadUserByEmail(orgId: string, email: string): Promise<DbUserRow | null> {
        const { rows } = await this.pg.query<DbUserRow>(
            `SELECT
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                u.password_hash,
                u.status,
                u.organization_id,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name))
                         FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles,
                COALESCE(array_agg(DISTINCT rp.permission_key)
                         FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::text[]) AS permissions
             FROM public.users u
             LEFT JOIN public.user_roles ur ON ur.user_id = u.id
             LEFT JOIN public.roles r ON r.id = ur.role_id
             LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
             WHERE u.organization_id = $1 AND LOWER(u.email) = LOWER($2)
             GROUP BY u.id
             LIMIT 1`,
            [orgId, email],
        );
        return rows[0] ?? null;
    }

    private async loadUserById(userId: string): Promise<DbUserRow | null> {
        const { rows } = await this.pg.query<DbUserRow>(
            `SELECT
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                u.password_hash,
                u.status,
                u.organization_id,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name))
                         FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles,
                COALESCE(array_agg(DISTINCT rp.permission_key)
                         FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::text[]) AS permissions
             FROM public.users u
             LEFT JOIN public.user_roles ur ON ur.user_id = u.id
             LEFT JOIN public.roles r ON r.id = ur.role_id
             LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
             WHERE u.id = $1
             GROUP BY u.id
             LIMIT 1`,
            [userId],
        );
        return rows[0] ?? null;
    }

    private mapDbRowToWebUser(row: DbUserRow): WebUser {
        const roles: RoleSummary[] = Array.isArray(row.roles)
            ? row.roles
                  .map((r: any) => ({
                      id: String(r.id ?? ""),
                      name: String(r.name ?? "").trim(),
                  }))
                  .filter((r) => r.name.length > 0)
            : [];
        const primaryRole = roles[0]?.name || "user";
        const permissions = Array.isArray(row.permissions)
            ? row.permissions.map((p) => String(p).toLowerCase())
            : [];
        const displayName = this.buildDisplayName(row.first_name, row.last_name);

        return {
            id: row.id,
            organizationId: row.organization_id,
            email: row.email,
            name: displayName,
            role: primaryRole,
            roles,
            permissions,
        };
    }

    private buildDisplayName(first: string | null, last: string | null): string | null {
        const parts = [first?.trim(), last?.trim()].filter(Boolean) as string[];
        if (parts.length === 0) return null;
        return parts.join(" ");
    }
}
