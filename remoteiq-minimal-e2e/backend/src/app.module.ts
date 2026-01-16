// remoteiq-minimal-e2e/backend/src/app.module.ts

import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";

import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { WsModule } from "./ws/ws.module";
import { AgentsModule } from "./agents/agents.module";
import { JobsModule } from "./jobs/jobs.module";
import { DevicesModule } from "./devices/devices.module";
import { HealthModule } from "./health/health.module";
import { AdminModule } from "./admin/admin.module";
import { CompanyModule } from "./company/company.module";
import { BrandingModule } from "./branding/branding.module";
import { LocalizationModule } from "./localization/localization.module";
import { SupportModule } from "./support/support.module";
import { SupportLegalModule } from "./support-legal/support-legal.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { SmtpModule } from "./smtp/smtp.module";
import { ScheduleModule } from "@nestjs/schedule";
import { ImapModule } from "./imap/imap.module";
import { SessionCleanerService } from "./maintenance/session-cleaner.service";
import { CustomersModule } from "./customers/customers.module";
import { BackupsModule } from "./backups/backups.module";

import { JwtModule } from "@nestjs/jwt";

// ✅ correct path: the middleware file is under /auth, not /common
import { AuthCookieMiddleware } from "./auth/auth-cookie.middleware";

// ✅ bring PgPoolService into the AppModule DI context
import { StorageModule } from "./storage/storage.module";

// ✅ Tickets
import { TicketsModule } from "./tickets/tickets.module";

@Module({
    imports: [
        // Static files mounted at /static -> maps to /public
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, "..", "public"),
            serveRoot: "/static",
        }),

        // JwtService for auth components
        JwtModule.register({
            secret: process.env.JWT_SECRET ?? "dev-secret",
        }),

        // Base/shared
        CommonModule,

        // ✅ Storage (PgPoolService) must be available for main.ts interceptor registration
        StorageModule,

        // Feature modules
        BrandingModule,
        AuthModule,
        WsModule,
        AgentsModule,
        JobsModule,
        DevicesModule,
        HealthModule,
        AdminModule,
        CompanyModule,
        LocalizationModule,
        SupportModule,
        SupportLegalModule,
        UsersModule,
        RolesModule,
        CustomersModule,

        // Backups Module
        BackupsModule,

        // ✅ Tickets module
        TicketsModule,

        // SMTP + IMAP
        SmtpModule,
        ScheduleModule.forRoot(),
        ImapModule,
    ],
    providers: [
        // Daily cleanup of revoked sessions
        SessionCleanerService,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // Middleware is still useful (cookies parsing / light hydration), but guards will enforce auth.
        consumer
            .apply(AuthCookieMiddleware)
            .exclude(
                "healthz",
                "docs",
                "docs/(.*)",
                "api/docs",
                "api/docs/(.*)",
                "static/(.*)",      // static files
                "api/auth/login",   // login doesn’t need req.user
                "api/auth/logout"   // logout doesn’t need req.user
            )
            .forRoutes("*");
    }
}
