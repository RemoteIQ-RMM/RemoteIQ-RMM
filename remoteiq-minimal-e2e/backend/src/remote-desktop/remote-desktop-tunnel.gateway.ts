// backend/src/remote-desktop/remote-desktop-tunnel.gateway.ts

import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Server as WsServer } from "ws";
import type WebSocket from "ws";

import { PgPoolService } from "../storage/pg-pool.service";
import { RemoteDesktopTunnelService } from "./remote-desktop-tunnel.service";
import { toUint8 } from "./rdp-tunnel.framing";

type HelloMessage = {
    type: "hello";
    agentUuid: string; // can be agents.id or agents.agent_uuid
    agentToken: string;
};

const WS_OPEN = 1;

function safeSendJson(ws: WebSocket, msg: any) {
    if ((ws as any).readyState !== WS_OPEN) return;
    try {
        ws.send(JSON.stringify(msg));
    } catch {
        // ignore
    }
}

function rawToUtf8(data: any): string {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
    if (ArrayBuffer.isView(data)) {
        const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return Buffer.from(u8).toString("utf8");
    }
    try {
        return String(data ?? "");
    } catch {
        return "";
    }
}

@WebSocketGateway({
    path: "/ws/desktop-tunnel",
})
export class RemoteDesktopTunnelGateway {
    private readonly logger = new Logger("RemoteDesktopTunnelGateway");

    @WebSocketServer()
    server!: WsServer;

    constructor(
        private readonly pg: PgPoolService,
        private readonly tunnels: RemoteDesktopTunnelService
    ) { }

    // Nest will call this automatically if present
    handleConnection(client: WebSocket) {
        (client as any).__rdpAuthed = false;
        (client as any).__rdpAgentId = null;

        this.logger.debug(`Desktop tunnel agent WS connected (awaiting hello)`);

        // ws "message" provides (data, isBinary)
        (client as any).on?.("message", (data: any, isBinary: boolean) => {
            void this.handleMessage(client, data, Boolean(isBinary));
        });

        (client as any).on?.("close", () => this.handleDisconnect(client));
        (client as any).on?.("error", () => this.handleDisconnect(client));
    }

    // Nest will call this automatically if present
    handleDisconnect(client: WebSocket) {
        const authed = Boolean((client as any).__rdpAuthed);
        const agentId = String((client as any).__rdpAgentId || "");

        // clear flags early to avoid double-unregister paths
        (client as any).__rdpAuthed = false;
        (client as any).__rdpAgentId = null;

        if (authed && agentId) {
            try {
                this.tunnels.unregisterAgent(agentId, client);
            } catch {
                // ignore
            }
            this.logger.warn(`Desktop tunnel agent WS disconnected: agentId=${agentId}`);
        }
    }

    private async handleMessage(client: WebSocket, data: any, isBinary: boolean) {
        // Text (ws often delivers text as Buffer; trust isBinary flag)
        if (!isBinary) {
            const text = rawToUtf8(data);
            if (!text) return;

            let msg: any;
            try {
                msg = JSON.parse(text);
            } catch {
                return;
            }

            if (msg?.type === "hello") {
                await this.handleHello(client, msg as HelloMessage);
                return;
            }

            const authed = Boolean((client as any).__rdpAuthed);
            const agentId = String((client as any).__rdpAgentId || "");
            if (!authed || !agentId) return;

            this.tunnels.handleAgentText(agentId, msg);
            return;
        }

        // Binary
        const authed = Boolean((client as any).__rdpAuthed);
        const agentId = String((client as any).__rdpAgentId || "");
        if (!authed || !agentId) return;

        const u8 = toUint8(data);
        if (!u8) return;

        // Hand normalized bytes to the tunnel service
        this.tunnels.handleAgentBinary(agentId, u8);
    }

    private async handleHello(client: WebSocket, hello: HelloMessage) {
        const agentUuid = String(hello?.agentUuid || "").trim();
        const agentToken = String(hello?.agentToken || "").trim();

        if (!agentUuid || !agentToken) {
            safeSendJson(client, { type: "hello.error", message: "Missing agentUuid/agentToken" });
            try {
                client.close();
            } catch { }
            return;
        }

        // Resolve canonical agent id
        const found = await this.pg.query<{ id: string }>(
            `SELECT id::text AS id
       FROM public.agents
       WHERE id::text = $1 OR agent_uuid::text = $1
       LIMIT 1`,
            [agentUuid]
        );

        const row = found.rows?.[0];
        if (!row?.id) {
            safeSendJson(client, { type: "hello.error", message: "Unknown agent" });
            try {
                client.close();
            } catch { }
            return;
        }

        // Validate token
        const ok = await this.pg.query<{ ok: number }>(
            `SELECT 1 AS ok
       FROM public.agents
       WHERE (id::text = $1 OR agent_uuid::text = $1)
         AND agent_token = $2
       LIMIT 1`,
            [agentUuid, agentToken]
        );

        if (!ok.rows?.length) {
            safeSendJson(client, { type: "hello.error", message: "Unauthorized" });
            try {
                client.close();
            } catch { }
            return;
        }

        (client as any).__rdpAuthed = true;
        (client as any).__rdpAgentId = row.id;

        this.tunnels.registerAgent(row.id, client);

        this.logger.log(`Desktop tunnel agent authenticated + registered: agentId=${row.id}`);

        safeSendJson(client, { type: "hello.ok", agentId: row.id });
    }
}
