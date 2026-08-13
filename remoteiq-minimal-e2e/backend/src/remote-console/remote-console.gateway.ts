// backend/src/remote-console/remote-console.gateway.ts

import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Server as WsServer } from "ws";
import type WebSocket from "ws";

import { RemoteConsoleService } from "./remote-console.service";

@WebSocketGateway({
    path: "/ws/remote-console",
})
export class RemoteConsoleGateway {
    private readonly logger = new Logger("RemoteConsoleGateway");

    @WebSocketServer()
    server!: WsServer;

    constructor(private readonly rc: RemoteConsoleService) { }

    handleConnection(client: WebSocket) {
        (client as any).__rcAuthed = false;
        (client as any).__rcKind = null;

        this.logger.debug(`remote-console WS connected (awaiting hello)`);

        (client as any).on?.("message", (data: any, isBinary: boolean) => {
            void this.rc.handleWsMessage(client, data, Boolean(isBinary));
        });

        (client as any).on?.("close", () => this.handleDisconnect(client));
        (client as any).on?.("error", () => this.handleDisconnect(client));
    }

    private handleDisconnect(client: WebSocket) {
        try {
            this.rc.handleSocketClosed(client);
        } catch {
            // ignore
        }
    }
}
