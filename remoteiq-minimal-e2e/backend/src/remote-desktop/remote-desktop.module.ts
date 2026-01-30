// backend/src/remote-desktop/remote-desktop.module.ts

import { Module } from "@nestjs/common";
import { RemoteDesktopService } from "./remote-desktop.service";
import { RemoteDesktopTunnelGateway } from "./remote-desktop-tunnel.gateway";

@Module({
    providers: [RemoteDesktopService, RemoteDesktopTunnelGateway],
    exports: [RemoteDesktopService],
})
export class RemoteDesktopModule { }
