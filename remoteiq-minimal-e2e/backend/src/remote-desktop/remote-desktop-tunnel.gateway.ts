// backend/src/remote-desktop/remote-desktop-tunnel.gateway.ts

import { Logger, OnModuleDestroy } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { Server } from "ws";

import { RemoteDesktopService } from "./remote-desktop.service";
import { decodeFrame } from "./rdp-tunnel.framing";
import type { BackendControlMessage } from "./remote-desktop.types";

type Role = "agent";

const WS_OPEN = 1;

function safeJsonParse(s: string): any | null {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function getQuery(req: IncomingMessage): URLSearchParams {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    return url.searchParams;
}

@WebSocketGateway({
    path: "/ws/desktop-tunnel",
})
export class RemoteDesktopTunnelGateway implements OnModuleDestroy {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger("RemoteDesktopTunnelGateway");

    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(private readonly desktop: RemoteDesktopService) { }

    afterInit(server: Server) {
        // Heartbeat: ping/pong to detect dead connections and force cleanup
        server.on("connection", (ws: WebSocket) => {
            (ws as any).isAlive = true;
            (ws as any).on("pong", () => {
                (ws as any).isAlive = true;
            });
        });

        this.heartbeatTimer = setInterval(() => {
            try {
                for (const client of this.server.clients) {
                    const anyClient = client as any;
                    if (anyClient.isAlive === false) {
                        try {
                            client.terminate();
                        } catch { }
                        continue;
                    }
                    anyClient.isAlive = false;
                    try {
                        (client as any).ping();
                    } catch { }
                }
            } catch {
                // ignore
            }
        }, 30_000);
    }

    onModuleDestroy() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    handleConnection(client: WebSocket, req: IncomingMessage) {
        try {
            const q = getQuery(req);
            const role = ((q.get("role") as Role) || "agent").trim() as Role;
            const agentUuid = (q.get("agentUuid") || "").trim();

            if (role !== "agent") {
                try { client.close(); } catch { }
                return;
            }

            if (!agentUuid) {
                try { client.close(); } catch { }
                return;
            }

            // tag socket
            (client as any).__role = role;
            (client as any).__agentUuid = agentUuid;

            // register agent
            this.desktop.registerAgent(agentUuid, client);
            this.logger.log(`Agent connected (desktop tunnel) for agentUuid ${agentUuid}`);

            (client as any).on("message", (raw: any) => {
                const isBinary =
                    raw instanceof ArrayBuffer ||
                    ArrayBuffer.isView(raw) ||
                    (typeof Buffer !== "undefined" && Buffer.isBuffer(raw));

                if (isBinary) {
                    // Normalize to Uint8Array without Buffer methods
                    let bytes: Uint8Array;
                    if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
                    else if (ArrayBuffer.isView(raw)) bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                    else bytes = new Uint8Array(raw); // Buffer is Uint8Array-compatible

                    try {
                        const frame = decodeFrame(bytes);
                        this.desktop.receiveBinaryFromAgent(frame.sessionId, frame.payload);
                    } catch (e: any) {
                        this.logger.warn(`Binary frame decode error agent=${agentUuid}: ${e?.message || e}`);
                    }
                    return;
                }

                const text =
                    typeof raw === "string"
                        ? raw
                        : raw?.toString
                            ? raw.toString("utf8")
                            : "";

                const msg = safeJsonParse(text);
                if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

                const typed = msg as BackendControlMessage;

                if (typed.type === "rdp.ready") {
                    this.desktop.markReady(typed.sessionId);
                    return;
                }
                if (typed.type === "rdp.error") {
                    this.desktop.markError(typed.sessionId, typed.code, typed.message);
                    // end session so TCP server is not left open
                    this.desktop.endSession(typed.sessionId, "agent_error");
                    return;
                }
                if (typed.type === "rdp.closed") {
                    this.desktop.handleAgentClosed(typed.sessionId, typed.reason);
                    return;
                }
                if (typed.type === "pong") {
                    this.desktop.handlePong(agentUuid, typed.ts);
                    return;
                }
            });

            (client as any).on("close", () => {
                this.handleDisconnect(client);
            });
        } catch (e: any) {
            this.logger.warn(`handleConnection failed: ${e?.message || e}`);
            try { client.close(); } catch { }
        }
    }

    handleDisconnect(client: WebSocket) {
        const agentUuid = String((client as any).__agentUuid || "");
        if (agentUuid) {
            this.desktop.unregisterAgent(agentUuid, client);
            this.logger.log(`Agent disconnected (desktop tunnel) for agentUuid ${agentUuid}`);
        }
    }
}
