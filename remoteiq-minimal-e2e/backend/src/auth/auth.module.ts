// backend/src/auth/auth.module.ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { StorageModule } from "../storage/storage.module";

import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UserAuthService } from "./user-auth.service";
import { LegacyAuthController } from "./user-auth.controller";

// ✅ global guards (single instance)
import { AuthCookieGuard } from "./auth-cookie.guard";
import { PermissionsGuard } from "./permissions.guard";

function parseExpiresToSeconds(input: string | undefined, fallbackSeconds: number): number {
  if (!input) return fallbackSeconds;
  if (/^\d+$/.test(input)) return Number(input);
  const m = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : 1;
  return n * factor;
}

const EXPIRES_IN_SECONDS = parseExpiresToSeconds(process.env.JWT_EXPIRES, 60 * 60 * 24 * 7);

@Module({
  imports: [
    StorageModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-secret",
      signOptions: { expiresIn: EXPIRES_IN_SECONDS },
    }),
  ],
  controllers: [
    AuthController,
    LegacyAuthController, // /api/auth-legacy (keep if you want it)
  ],
  providers: [
    AuthService,
    UserAuthService,

    // ✅ provide guards ONCE here
    AuthCookieGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    UserAuthService,
    JwtModule,

    // ✅ export guards so main.ts can app.get() them
    AuthCookieGuard,
    PermissionsGuard,
  ],
})
export class AuthModule { }
