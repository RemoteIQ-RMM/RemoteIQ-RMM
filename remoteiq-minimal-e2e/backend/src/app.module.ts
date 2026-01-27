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
import { StorageModule } from "./storage/storage.module";
import { TicketsModule } from "./tickets/tickets.module";

import { AuthCookieMiddleware } from "./auth/auth-cookie.middleware";
import { CompatModule } from "./compat/compat.module";
import { EndpointsModule } from "./endpoints/endpoints.module";
import { PatchesModule } from "./patches/patches.module";

// ✅ NEW
import { ProvisioningModule } from "./provisioning/provisioning.module";

@Module({
    imports: [
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, "..", "public"),
            serveRoot: "/static",
        }),

        CommonModule,
        StorageModule,

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
        BackupsModule,
        TicketsModule,
        EndpointsModule,

        // ✅ compatibility endpoints for ticketing UI
        CompatModule,

        // ✅ NEW provisioning endpoints for dashboard-generated installers
        ProvisioningModule,

        SmtpModule,
        ScheduleModule.forRoot(),
        ImapModule,
        PatchesModule,
    ],
    providers: [SessionCleanerService],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(AuthCookieMiddleware)
            .exclude(
                "healthz",
                "docs",
                "docs/(.*)",
                "api/docs",
                "api/docs/(.*)",
                "static/(.*)",
                "api/auth/login",
                "api/auth/logout"
            )
            .forRoutes("*");
    }
}
