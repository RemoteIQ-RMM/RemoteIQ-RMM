import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { ProvisioningController } from "./provisioning.controller";
import { ProvisioningService } from "./provisioning.service";

@Module({
    imports: [StorageModule],
    controllers: [ProvisioningController],
    providers: [ProvisioningService],
})
export class ProvisioningModule { }
