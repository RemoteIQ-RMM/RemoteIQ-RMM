import { Module, forwardRef } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { CommonModule } from "../common/common.module";

import { ChecksService } from "./checks.service";
import { ChecksController, DeviceChecksController } from "./checks.controller";

import { WsModule } from "../ws/ws.module";
import { JobsModule } from "../jobs/jobs.module";

@Module({
    imports: [
        StorageModule,
        CommonModule,
        forwardRef(() => WsModule),
        forwardRef(() => JobsModule),
    ],
    controllers: [
        ChecksController,
        DeviceChecksController,
    ],
    providers: [
        ChecksService,
    ],
    exports: [
        ChecksService,
    ],
})
export class ChecksModule { }
