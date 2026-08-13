// backend/src/remote-console/remote-console.module.ts

import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";

import { RemoteConsoleGateway } from "./remote-console.gateway";
import { RemoteConsoleService } from "./remote-console.service";
import { RemoteConsoleController } from "./remote-console.controller";

@Module({
    imports: [StorageModule],
    controllers: [RemoteConsoleController],
    providers: [RemoteConsoleGateway, RemoteConsoleService],
    exports: [RemoteConsoleService],
})
export class RemoteConsoleModule { }
