import { Module } from "@nestjs/common";
import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";
import { CronPreviewService } from "./cron-preview.service";
import { StorageConnectionsLiteController } from "./storage-connections-lite.controller";
import { PgPoolService } from "../storage/pg-pool.service";
import { PermissionsGuard } from "../auth/permissions.guard";
import { Reflector } from "@nestjs/core";
import { SchedulerService } from "./scheduler.service";
import { WorkerService } from "./worker.service";
import { NotifierService } from "./notifier.service";

@Module({
    controllers: [BackupsController, StorageConnectionsLiteController],
    providers: [
        BackupsService,
        CronPreviewService,
        PgPoolService,
        PermissionsGuard,
        Reflector,
        SchedulerService,
        WorkerService,
        NotifierService,
        
    ],
    exports: [BackupsService],
})
export class BackupsModule { }
