import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";

import { SmtpController } from "./smtp.controller";
import { SmtpService } from "./smtp.service";
import { SmtpRepository } from "./smtp.repository";
import { DkimRepository } from "./dkim.repository";

@Module({
    imports: [StorageModule],
    controllers: [SmtpController],
    providers: [SmtpService, SmtpRepository, DkimRepository],
    exports: [SmtpService, SmtpRepository, DkimRepository],
})
export class SmtpModule { }
