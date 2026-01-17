import { Module } from "@nestjs/common";

import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";
import { CronPreviewService } from "./cron-preview.service";
import { SchedulerService } from "./scheduler.service";
import { WorkerService } from "./worker.service";
import { NotifierService } from "./notifier.service";

import { StorageModule } from "../storage/storage.module";
import { SmtpModule } from "../smtp/smtp.module";

@Module({
    imports: [
        StorageModule, // ✅ PgPoolService + OrganizationContextService
        SmtpModule,    // ✅ if NotifierService uses SmtpService
    ],
    controllers: [BackupsController],
    providers: [
        BackupsService,
        CronPreviewService,
        SchedulerService,
        WorkerService,
        NotifierService,
    ],
    exports: [BackupsService],
})
export class BackupsModule { }
