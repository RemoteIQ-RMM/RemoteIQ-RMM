// backend/src/remote-desktop/remote-desktop.module.ts

import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";

import { RemoteDesktopTunnelService } from "./remote-desktop-tunnel.service";
import { RemoteDesktopTunnelGateway } from "./remote-desktop-tunnel.gateway";

import { RemoteDesktopDevController } from "./remote-desktop-dev.controller";
import { RemoteDesktopController } from "./remote-desktop.controller";

@Module({
    imports: [StorageModule], // provides PgPoolService
    controllers: [
        RemoteDesktopController,     // ✅ real API
        RemoteDesktopDevController,  // ✅ dev-only helpers
    ],
    providers: [
        RemoteDesktopTunnelService,
        RemoteDesktopTunnelGateway, // ✅ gateways must be providers
    ],
    exports: [RemoteDesktopTunnelService],
})
export class RemoteDesktopModule { }
