import {
    Body,
    Controller,
    Delete,
    Get,
    HttpException,
    HttpStatus,
    Inject,
    Param,
    Post,
    Req,
    UnauthorizedException,
    HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import { SecurityService } from "./security.service";
import { IsBoolean, IsOptional, IsString, Length, IsUUID, MinLength } from "class-validator";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { RequirePerm } from "../auth/require-perm.decorator";

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

@Controller("/api/users/me")
export class SecurityController {
    constructor(@Inject(SecurityService) private readonly security: SecurityService) { }

    @Get("security")
    @RequirePerm("me.security")
    async getOverview(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.securityOverview(user.id, (req as any).jti);
    }

    @Post("password")
    @RequirePerm("me.security")
    async changePassword(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(ChangePasswordDto, body);
        await this.security.changePassword(user.id, dto.current, dto.next);
        return { ok: true };
    }

    @Post("2fa/start")
    @RequirePerm("me.security")
    async start2fa(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id || !user?.email) throw new UnauthorizedException();
        return this.security.start2fa(user.id, user.email);
    }

    @Post("2fa/confirm")
    @RequirePerm("me.security")
    async confirm2fa(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TotpConfirmDto, body);
        const clean = (dto.code || "").replace(/\D/g, "").slice(-6);
        if (clean.length !== 6) throw new HttpException("Invalid TOTP code format.", HttpStatus.BAD_REQUEST);
        const recoveryCodes = await this.security.confirm2fa(user.id, clean);
        return { recoveryCodes };
    }

    @Post("2fa/disable")
    @RequirePerm("me.security")
    async disable2fa(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TotpDisableDto, body);
        const clean = dto.code ? dto.code.replace(/\D/g, "").slice(-6) : undefined;
        await this.security.disable2fa(user.id, clean, dto.recoveryCode);
        return { ok: true };
    }

    @Post("2fa/recovery/regen")
    @RequirePerm("me.security")
    async regenCodes(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const codes = await this.security.regenerateRecoveryCodes(user.id);
        return { recoveryCodes: codes };
    }

    @Get("sessions")
    @RequirePerm("me.security")
    async listSessionsNoSlash(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listSessions(user.id, (req as any).jti);
    }

    @Get("sessions/")
    @RequirePerm("me.security")
    async listSessionsSlash(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listSessions(user.id, (req as any).jti);
    }

    @Post("sessions/:id/trust")
    @RequirePerm("me.security")
    async trust(@Req() req: Request, @Param("id") id: string, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(TrustDto, body);
        return this.security.setSessionTrust(user.id, id, dto.trusted);
    }

    @Delete("sessions/:id")
    @RequirePerm("me.security")
    @HttpCode(204)
    async revokeOne(@Req() req: Request, @Param("id") id: string) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        await this.security.revokeSession(user.id, id, (req as any).jti);
        return;
    }

    @Post("sessions/revoke")
    @RequirePerm("me.security")
    async revokeSession(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(RevokeSessionDto, body);
        await this.security.revokeSession(user.id, dto.sessionId, (req as any).jti);
        return { ok: true };
    }

    @Post("sessions/revoke-all")
    @RequirePerm("me.security")
    @HttpCode(204)
    async revokeAllOther(@Req() req: Request) {
        const user = (req as any).user;
        const currentJti = (req as any).jti;
        if (!user?.id) throw new UnauthorizedException();
        await this.security.revokeAllOtherSessions(user.id, currentJti);
        return;
    }

    @Get("tokens")
    @RequirePerm("me.security")
    async listTokens(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.listTokens(user.id);
    }

    @Post("tokens")
    @RequirePerm("me.security")
    async createToken(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(CreateTokenDto, body);
        return this.security.createToken(user.id, dto.name);
    }

    @Post("tokens/revoke")
    @RequirePerm("me.security")
    async revokeToken(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        const dto = assertDto(RevokeTokenDto, body);
        await this.security.revokeToken(user.id, dto.id);
        return { ok: true };
    }

    @Get("webauthn/create-options")
    @RequirePerm("me.security")
    async webauthnCreate(@Req() req: Request) {
        const user = (req as any).user;
        if (!user?.id || !user?.email) throw new UnauthorizedException();
        return this.security.webauthnCreateOptions(user.id, user.email);
    }

    @Post("webauthn/finish")
    @RequirePerm("me.security")
    async webauthnFinish(@Req() req: Request, @Body() body: any) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.webauthnFinish(user.id, body);
    }

    @Delete("webauthn/:id")
    @RequirePerm("me.security")
    async deleteWebAuthn(@Req() req: Request, @Param("id") id: string) {
        const user = (req as any).user;
        if (!user?.id) throw new UnauthorizedException();
        return this.security.deleteWebAuthn(user.id, id);
    }
}
