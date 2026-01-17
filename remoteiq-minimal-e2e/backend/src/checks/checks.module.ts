import { Module, forwardRef } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { CommonModule } from "../common/common.module";

import { ChecksService } from "./checks.service";
import { ChecksController } from "./checks.controller";
import { ChecksReadController } from "./checks.read.controller";
import { ChecksIngestController } from "./checks.ingest.controller";
import { ChecksRuntimeService } from "./checks.runtime.service";

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
        ChecksReadController,
        ChecksIngestController,
    ],
    providers: [
        ChecksService,
        ChecksRuntimeService,
    ],
    exports: [
        ChecksService,
        ChecksRuntimeService,
    ],
})
export class ChecksModule { }
