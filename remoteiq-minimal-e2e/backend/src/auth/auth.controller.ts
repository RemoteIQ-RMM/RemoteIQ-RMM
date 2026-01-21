// backend/src/auth/auth.controller.ts

import { Body, Controller, Get, Post, Req, Res, BadRequestException } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { LoginDto } from "./dto/login.dto";
import { Verify2FADto } from "./dto/verify-2fa.dto";
import { UserAuthService } from "./user-auth.service";
import { PgPoolService } from "../storage/pg-pool.service";
import { Public } from "./public.decorator";

@ApiTags("auth")
@Controller("api/auth")
export class AuthController {
    constructor(
        private readonly users: UserAuthService,
        private readonly db: PgPoolService,          // ⬅️ DB access for permissions
    ) { }

    /**
     * Utility: fetch flattened permission keys for a user.
     * Tries role_permissions first; if that table doesn't exist, falls back to roles_permissions.
     */
    private async getUserPermissions(userId: string): Promise<string[]> {
        const exists = async (table: string) => {
            const q = `
        SELECT 1
          FROM information_schema.tables
         WHERE table_name = $1
         LIMIT 1
      `;
            const r = await this.db.query(q, [table]);
            return r.rowCount > 0;
        };

        const hasRolePerm = await exists("role_permissions");
        const hasRolesPerm = !hasRolePerm ? await exists("roles_permissions") : false;

        const joinTable = hasRolePerm ? "role_permissions" : hasRolesPerm ? "roles_permissions" : null;

        if (!joinTable) return [];

        const sql = `
      SELECT DISTINCT rp.permission_key
        FROM user_roles ur
        JOIN ${joinTable} rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1
    `;
        const res = await this.db.query(sql, [userId]);
        return res.rows.map((r: any) => r.permission_key).filter(Boolean);
    }

    @Public()
    @Post("login")
    @ApiOkResponse({ description: "Sets auth cookie on success or returns 2FA challenge when required" })
    async login(
        @Body() dto: LoginDto & { deviceFingerprint?: string },
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        // 1) Validate user
        const user = await this.users.validateUser(dto.email, dto.password);

        // 2) 2FA gate
        const is2FAEnabled = await this.users.isTwoFactorEnabled(user.id);
        const deviceTrusted = await this.users.isDeviceTrusted(user.id, dto.deviceFingerprint ?? null);
        if (is2FAEnabled && !deviceTrusted) {
            const { token: challengeToken, jti } = await this.users.createChallengeToken(user.id);
            return { status: "2fa_required" as const, challengeToken, jti };
        }

        // 3) Issue JWT with JTI
        const { token, jti } = await this.users.signWithJti(user);

        // 4) Record session
        const ua = req.headers["user-agent"] || "";
        const ip =
            (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            (req.socket as any)?.remoteAddress ||
            "";
        await this.users.recordSessionOnLogin(user.id, jti, String(ua), String(ip));

        // 5) Set cookie
        const cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
        const maxAgeMs = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000); // 7d
        res.cookie(cookieName, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: maxAgeMs,
        });

        // 6) Attach permissions (so FE can use immediately after login if desired)
        const permissions = await this.getUserPermissions(user.id);

        return { user: { ...user, permissions } };
    }

    @Public()
    @Post("2fa/verify")
    @ApiOkResponse({ description: "Verifies TOTP or recovery code and sets auth cookie" })
    async verify2FA(@Body() dto: Verify2FADto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        if (dto.code) dto.code = dto.code.trim();
        if (dto.recoveryCode) dto.recoveryCode = dto.recoveryCode.trim();

        if (!dto.code && !dto.recoveryCode) {
            throw new BadRequestException("Provide either 'code' or 'recoveryCode'.");
        }

        const { userId, jti } = await this.users.verifyChallengeToken(dto.challengeToken);

        let ok = false;
        if (dto.code) ok = await this.users.verifyTOTP(userId, dto.code);
        else if (dto.recoveryCode) ok = await this.users.consumeRecoveryCode(userId, dto.recoveryCode);

        if (!ok) throw new BadRequestException("Invalid code");

        const user = await this.users.findUserById(userId);
        const { token, jti: newJti } = await this.users.signWithJti(user);

        const ua = req.headers["user-agent"] || "";
        const ip =
            (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            (req.socket as any)?.remoteAddress ||
            "";
        await this.users.recordSessionOnLogin(userId, newJti, String(ua), String(ip));

        const cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
        const maxAgeMs = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
        res.cookie(cookieName, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: maxAgeMs,
        });

        if (dto.rememberDevice) {
            const fp = dto.deviceFingerprint ?? jti;
            await this.users.trustCurrentDevice(userId, fp);
        }

        return { ok: true };
    }

    @Public()
    @Post("logout")
    @ApiOkResponse({ description: "Clears auth cookie" })
    async logout(@Res({ passthrough: true }) res: Response) {
        const cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
        res.clearCookie(cookieName, { path: "/" });
        return { ok: true };
    }

    @Public()
    @Get("me")
    @ApiOkResponse({ description: "Current user (if authenticated)" })
    async me(@Req() req: Request) {
        const cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
        const token = (req as any).cookies?.[cookieName];
        if (!token) return { user: null };

        const user = await this.users.verify(token);
        if (!user?.id) return { user: null };

        const permissions = await this.getUserPermissions(user.id);

        return { user: { ...user, permissions } };
    }
}
