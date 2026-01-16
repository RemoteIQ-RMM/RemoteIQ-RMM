import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    Param,
    Post,
    Req,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SecurityService } from "./security.service";
import {
    IsBoolean,
    IsOptional,
    IsString,
    Length,
    IsUUID,
    MinLength,
} from "class-validator";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { AuthCookieGuard } from "../auth/auth-cookie.guard";

/* ---------------- DTOs ---------------- */

class ChangePasswordDto {
    @IsString()
    current!: string;

    @IsString()
    @MinLength(parseInt(process.env.PASSWORD_MIN_LEN || "8", 10) || 8)
    next!: string;
}

class TotpConfirmDto {
    @IsString()
    @Length(6, 6)
    code!: string;
}

class TotpDisableDto {
    @IsOptional()
    @IsString()
    @Length(6, 6)
    code?: string;

    @IsOptional()
    @IsString()
    recoveryCode?: string;
}

class RevokeSessionDto {
    @IsString()
    @IsUUID()
    sessionId!: string;
}

class CreateTokenDto {
    @IsString()
    name!: string;
}

class RevokeTokenDto {
    @IsString()
    @IsUUID()
    id!: string;
}

class TrustDto {
    @IsBoolean()
    trusted!: boolean;
}

/** validate without relying on global pipes */
function assertDto<T>(cls: new () => T, payload: any) {
    const inst = plainToInstance(cls, payload, { enableImplicitConversion: true });
    const errs = validateSync(inst as any, {
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    });
    if (errs.length) {
        const msg =
            errs[0]?.constraints && Object.values(errs[0].constraints)[0]
                ? Object.values(errs[0].constraints)[0]
                : "Validation failed";
        throw new HttpException(String(msg), HttpStatus.BAD_REQUEST);
    }
    return inst;
}

/* -------------------------------- Controller -------------------------------- */

@Controller("/api/users/me")
@UseGuards(AuthCookieGuard) // ensures req.user and req.jti are populated
export class SecurityController {
    constructor(@Inject(SecurityService) private readonly security: SecurityService) { }

    // -------- Overview --------
    @Get("security")
    async getOverview(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.securityOverview(user.id, (req as any).jti);
    }

    // -------- Password --------
    @Post("password")
    async changePassword(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(ChangePasswordDto, body);
        await this.security.changePassword(user.id, dto.current, dto.next);
        return { ok: true };
    }

    // -------- TOTP 2FA --------
    @Post("2fa/start")
    async start2fa(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id || !user?.email) throw new UnauthorizedException();
        return this.security.start2fa(user.id, user.email);
    }

    @Post("2fa/confirm")
    async confirm2fa(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TotpConfirmDto, body);
        const clean = (dto.code || "").replace(/\D/g, "").slice(-6);
        if (clean.length !== 6) {
            throw new HttpException("Invalid TOTP code format.", HttpStatus.BAD_REQUEST);
        }
        const recoveryCodes = await this.security.confirm2fa(user.id, clean);
        return { recoveryCodes };
    }

    @Post("2fa/disable")
    async disable2fa(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TotpDisableDto, body);
        const clean = dto.code ? dto.code.replace(/\D/g, "").slice(-6) : undefined;
        await this.security.disable2fa(user.id, clean, dto.recoveryCode);
        return { ok: true };
    }

    @Post("2fa/recovery/regen")
    async regenCodes(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const codes = await this.security.regenerateRecoveryCodes(user.id);
        return { recoveryCodes: codes };
    }

    // -------- Sessions --------

    // Support both with & without trailing slash (FE sometimes hits /)
    @Get("sessions")
    async listSessionsNoSlash(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listSessions(user.id, (req as any).jti);
    }

    @Get("sessions/")
    async listSessionsSlash(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listSessions(user.id, (req as any).jti);
    }

    // Trust / Untrust a session
    @Post("sessions/:id/trust")
    async trust(@Req() req: Request, @Param("id") id: string, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TrustDto, body);
        return this.security.setSessionTrust(user.id, id, dto.trusted);
    }

    // DELETE /api/users/me/sessions/:id  (blocks current inside the service)
    @Delete("sessions/:id")
    @HttpCode(204)
    async revokeOne(@Req() req: Request, @Param("id") id: string) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        await this.security.revokeSession(user.id, id, (req as any).jti);
        return;
    }

    // Optional back-compat: POST body { sessionId }
    @Post("sessions/revoke")
    async revokeSession(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(RevokeSessionDto, body);
        await this.security.revokeSession(user.id, dto.sessionId, (req as any).jti);
        return { ok: true };
    }

    // POST /api/users/me/sessions/revoke-all
    @Post("sessions/revoke-all")
    @HttpCode(204)
    async revokeAllOther(@Req() req: Request) {
        const user = (req as any).user;
        const currentJti = (req as any).jti;
        if (!user?.id) throw new UnauthorizedException();
        await this.security.revokeAllOtherSessions(user.id, currentJti);
        return;
    }

    // -------- Personal Tokens --------
    @Get("tokens")
    async listTokens(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listTokens(user.id);
    }

    @Post("tokens")
    async createToken(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(CreateTokenDto, body);
        return this.security.createToken(user.id, dto.name);
    }

    @Post("tokens/revoke")
    async revokeToken(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(RevokeTokenDto, body);
        await this.security.revokeToken(user.id, dto.id);
        return { ok: true };
    }

    // -------- WebAuthn (stubs) --------
    @Get("webauthn/create-options")
    async webauthnCreate(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id || !user?.email) throw new UnauthorizedException();
        return this.security.webauthnCreateOptions(user.id, user.email);
    }

    @Post("webauthn/finish")
    async webauthnFinish(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.webauthnFinish(user.id, body);
    }

    @Delete("webauthn/:id")
    async deleteWebAuthn(@Req() req: Request, @Param("id") id: string) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.deleteWebAuthn(user.id, id);
    }
}
