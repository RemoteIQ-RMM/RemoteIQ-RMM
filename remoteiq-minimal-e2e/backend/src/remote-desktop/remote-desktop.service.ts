// backend/src/remote-desktop/remote-desktop.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import type WebSocket from "ws";

import { encodeDataFrame } from "./rdp-tunnel.framing";
import type { DesktopTunnelSession } from "./remote-desktop.types";

const WS_OPEN = 1;

@Injectable()
export class RemoteDesktopService {
    private readonly logger = new Logger("RemoteDesktop");

    // One agent WS per agentUuid
    private readonly agents = new Map<string, WebSocket>();

    // Session manager
    private readonly sessions = new Map<string, DesktopTunnelSession>();

    // Phase 1 basic orphan guard (Phase 4 will tighten and audit)
    private readonly SESSION_IDLE_MS = 5 * 60_000;

    constructor() {
        setInterval(() => this.cleanupOrphans(), 30_000).unref();
    }

    // ---------------- Agent Registry ----------------

    registerAgent(agentUuid: string, ws: WebSocket) {
        const existing = this.agents.get(agentUuid);
        if (existing && existing !== ws) {
            try {
                existing.close();
            } catch { }
        }
        this.agents.set(agentUuid, ws);
        this.logger.log(`agent connected ${agentUuid}`);
    }

    unregisterAgent(agentUuid: string, ws: WebSocket) {
        const cur = this.agents.get(agentUuid);
        if (cur === ws) {
            this.agents.delete(agentUuid);
            this.logger.warn(`agent disconnected ${agentUuid}`);
        }

        // Any sessions bound to this agent must be ended
        for (const s of this.sessions.values()) {
            if (s.agentUuid === agentUuid && s.state !== "closed") {
                this.endSession(s.sessionId, "agent_disconnected");
            }
        }
    }

    getAgentWs(agentUuid: string): WebSocket | undefined {
        return this.agents.get(agentUuid);
    }

    // ---------------- Sessions ----------------

    /**
     * Creates a session and opens a local TCP bridge port.
     * Phase 1: tunnel validation.
     * Phase 2: guacd will connect to localPort.
     */
    async createTunnelSession(agentUuid: string, targetHost: string, targetPort: number): Promise<{
        sessionId: string;
        localPort: number;
    }> {
        const ws = this.getAgentWs(agentUuid);
        if (!ws || (ws as any).readyState !== WS_OPEN) {
            throw new Error("Agent not connected");
        }

        const sessionId = randomUUID();
        const now = Date.now();

        const session: DesktopTunnelSession = {
            sessionId,
            agentUuid,
            createdAt: now,
            lastActivityAt: now,
            state: "opening",
        };

        // Create local TCP server on ephemeral port
        const server = net.createServer();
        session.tcpServer = server;

        // accept exactly one tcp client per session
        server.on("connection", (socket) => {
            if (session.tcpSocket && !session.tcpSocket.destroyed) {
                // deny extra connections
                try { socket.destroy(); } catch { }
                return;
            }

            session.tcpSocket = socket;
            session.lastActivityAt = Date.now();

            socket.on("data", (chunk) => {
                session.lastActivityAt = Date.now();
                // chunk is Buffer, which is Uint8Array compatible
                this.sendBinaryToAgent(sessionId, agentUuid, new Uint8Array(chunk));
            });

            socket.on("close", () => {
                session.lastActivityAt = Date.now();
                // If TCP client goes away (e.g., guacd disconnects), end the session
                this.endSession(sessionId, "tcp_client_closed");
            });

            socket.on("error", (err) => {
                this.logger.warn(`tcp socket error session=${sessionId}: ${err?.message || err}`);
                this.endSession(sessionId, "tcp_socket_error");
            });
        });

        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve());
        });

        const addr = server.address();
        if (!addr || typeof addr === "string") {
            try { server.close(); } catch { }
            throw new Error("Failed to allocate local port");
        }

        session.localPort = addr.port;

        this.sessions.set(sessionId, session);

        // Ask agent to open TCP to endpoint's RDP
        this.sendJsonToAgent(agentUuid, { type: "rdp.open", sessionId, host: targetHost, port: targetPort });

        return { sessionId, localPort: session.localPort };
    }

    getSession(sessionId: string): DesktopTunnelSession | undefined {
        return this.sessions.get(sessionId);
    }

    markReady(sessionId: string) {
        const s = this.sessions.get(sessionId);
        if (!s || s.state === "closed") return;
        s.state = "ready";
        s.lastActivityAt = Date.now();
    }

    markError(sessionId: string, code: string, message: string) {
        const s = this.sessions.get(sessionId);
        if (!s || s.state === "closed") return;
        s.state = "error";
        s.error = { code, message };
        s.lastActivityAt = Date.now();
    }

    receiveBinaryFromAgent(sessionId: string, payload: Uint8Array) {
        const s = this.sessions.get(sessionId);
        if (!s || s.state === "closed") return;

        s.lastActivityAt = Date.now();

        // Write to TCP client if connected
        const sock = s.tcpSocket;
        if (sock && !sock.destroyed) {
            try {
                sock.write(payload);
            } catch (e: any) {
                this.logger.warn(`failed to write to tcp session=${sessionId}: ${e?.message || e}`);
                this.endSession(sessionId, "tcp_write_failed");
            }
        }
    }

    sendBinaryToAgent(sessionId: string, agentUuid: string, payload: Uint8Array) {
        const ws = this.getAgentWs(agentUuid);
        if (!ws || (ws as any).readyState !== WS_OPEN) {
            this.endSession(sessionId, "agent_not_connected");
            return;
        }

        const framed = encodeDataFrame(sessionId, payload);
        try {
            ws.send(framed);
        } catch (e: any) {
            this.logger.warn(`ws send failed agent=${agentUuid} session=${sessionId}: ${e?.message || e}`);
            this.endSession(sessionId, "ws_send_failed");
        }
    }

    sendJsonToAgent(agentUuid: string, msg: any) {
        const ws = this.getAgentWs(agentUuid);
        if (!ws || (ws as any).readyState !== WS_OPEN) return;
        try {
            ws.send(JSON.stringify(msg));
        } catch {
            // ignore
        }
    }

    endSession(sessionId: string, reason: string) {
        const s = this.sessions.get(sessionId);
        if (!s || s.state === "closed") return;

        s.state = "closed";
        s.lastActivityAt = Date.now();

        // Tell agent to close its TCP connection
        this.sendJsonToAgent(s.agentUuid, { type: "rdp.close", sessionId, reason });

        // Close TCP socket/server
        try {
            if (s.tcpSocket && !s.tcpSocket.destroyed) s.tcpSocket.destroy();
        } catch { }

        try {
            if (s.tcpServer) s.tcpServer.close();
        } catch { }

        this.sessions.delete(sessionId);
        this.logger.log(`session ended ${sessionId} (${reason})`);
    }

    handleAgentClosed(sessionId: string, reason?: string) {
        this.endSession(sessionId, reason || "agent_closed");
    }

    handlePong(agentUuid: string, ts: number) {
        this.logger.debug?.(`pong agent=${agentUuid} ts=${ts}`);
    }

    private cleanupOrphans() {
        const now = Date.now();
        for (const s of this.sessions.values()) {
            if (s.state === "closed") continue;
            if (now - s.lastActivityAt > this.SESSION_IDLE_MS) {
                this.endSession(s.sessionId, "idle_timeout");
            }
        }
    }
}
