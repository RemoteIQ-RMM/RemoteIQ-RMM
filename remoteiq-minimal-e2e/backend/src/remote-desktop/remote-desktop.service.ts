// backend/src/remote-desktop/remote-desktop.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import type WebSocket from "ws";

import { encodeDataFrame } from "./rdp-tunnel.framing";
import type { DesktopTunnelSession } from "./remote-desktop.types";

const WS_OPEN = 1;

function normAgentKey(v: string) {
    return String(v || "").trim().toLowerCase();
}

@Injectable()
export class RemoteDesktopService {
    private readonly logger = new Logger("RemoteDesktop");

    /**
     * IMPORTANT:
     * If RemoteDesktopService is accidentally instantiated twice (e.g. provided in multiple modules),
     * instance-local Maps will diverge and you’ll see “Agent not connected” even though the gateway logged auth.
     *
     * To harden against that, we keep registries static so ALL instances share the same state.
     * (You should still ensure the service is only provided once, but this prevents the symptom.)
     */
    private static readonly AGENTS = new Map<string, WebSocket>(); // key: normalized agent uuid/id
    private static readonly SESSIONS = new Map<string, DesktopTunnelSession>();

    private static cleanerStarted = false;

    // Phase 1 basic orphan guard (Phase 4 will tighten and audit)
    private readonly SESSION_IDLE_MS = 5 * 60_000;

    constructor() {
        if (!RemoteDesktopService.cleanerStarted) {
            RemoteDesktopService.cleanerStarted = true;
            setInterval(() => {
                try {
                    // use a temp instance-less cleanup
                    const now = Date.now();
                    for (const s of RemoteDesktopService.SESSIONS.values()) {
                        if (s.state === "closed") continue;
                        if (now - s.lastActivityAt > 5 * 60_000) {
                            // we can’t call instance methods here safely; mark for closure by best-effort
                            s.state = "closed";
                            s.lastActivityAt = now;

                            try {
                                if (s.tcpSocket && !s.tcpSocket.destroyed) s.tcpSocket.destroy();
                            } catch { }
                            try {
                                if (s.tcpServer) s.tcpServer.close();
                            } catch { }

                            RemoteDesktopService.SESSIONS.delete(s.sessionId);
                        }
                    }
                } catch {
                    // ignore
                }
            }, 30_000).unref();
        }
    }

    // ---------------- Agent Registry ----------------

    registerAgent(agentUuid: string, ws: WebSocket) {
        const key = normAgentKey(agentUuid);
        if (!key) return;

        const existing = RemoteDesktopService.AGENTS.get(key);
        if (existing && existing !== ws) {
            try {
                existing.close();
            } catch { }
        }

        RemoteDesktopService.AGENTS.set(key, ws);
        this.logger.log(`agent connected ${agentUuid}`);
    }

    unregisterAgent(agentUuid: string, ws: WebSocket) {
        const key = normAgentKey(agentUuid);
        if (!key) return;

        const cur = RemoteDesktopService.AGENTS.get(key);
        if (cur === ws) {
            RemoteDesktopService.AGENTS.delete(key);
            this.logger.warn(`agent disconnected ${agentUuid}`);
        }

        // Any sessions bound to this agent must be ended
        for (const s of RemoteDesktopService.SESSIONS.values()) {
            if (normAgentKey(s.agentUuid) === key && s.state !== "closed") {
                this.endSession(s.sessionId, "agent_disconnected");
            }
        }
    }

    getAgentWs(agentUuid: string): WebSocket | undefined {
        const key = normAgentKey(agentUuid);
        if (!key) return undefined;
        return RemoteDesktopService.AGENTS.get(key);
    }

    listConnectedAgents() {
        return Array.from(RemoteDesktopService.AGENTS.keys());
    }

    // ---------------- Introspection (dev-only endpoints use this) ----------------

    listSessions() {
        return Array.from(RemoteDesktopService.SESSIONS.values()).map((s) => ({
            sessionId: s.sessionId,
            agentUuid: s.agentUuid,
            state: s.state,
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            localPort: s.localPort ?? null,
            error: s.error ?? null,
        }));
    }

    // ---------------- Sessions ----------------

    /**
     * Creates a session and opens a local TCP bridge port.
     * Phase 1: tunnel validation.
     * Phase 2: guacd will connect to localPort.
     */
    async createTunnelSession(
        agentUuid: string,
        targetHost: string,
        targetPort: number
    ): Promise<{ sessionId: string; localPort: number }> {
        const agentKey = normAgentKey(agentUuid);
        const ws = this.getAgentWs(agentKey);

        if (!ws || (ws as any).readyState !== WS_OPEN) {
            // Make debugging painless when this happens
            const connected = this.listConnectedAgents();
            this.logger.warn(
                `Agent not connected: requested=${agentUuid} (norm=${agentKey}) connectedKeys=[${connected.join(", ")}]`
            );
            throw new Error("Agent not connected");
        }

        const sessionId = randomUUID();
        const now = Date.now();

        const session: DesktopTunnelSession = {
            sessionId,
            agentUuid: agentKey, // store normalized
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
                try {
                    socket.destroy();
                } catch { }
                return;
            }

            session.tcpSocket = socket;
            session.lastActivityAt = Date.now();

            socket.on("data", (chunk) => {
                session.lastActivityAt = Date.now();
                // chunk is Buffer, which is Uint8Array compatible
                this.sendBinaryToAgent(sessionId, agentKey, new Uint8Array(chunk));
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
            try {
                server.close();
            } catch { }
            throw new Error("Failed to allocate local port");
        }

        session.localPort = addr.port;

        RemoteDesktopService.SESSIONS.set(sessionId, session);

        this.logger.log(
            `tunnel session created session=${sessionId} agent=${agentKey} localPort=${session.localPort} target=${targetHost}:${targetPort}`
        );

        // Ask agent to open TCP to endpoint's RDP
        this.sendJsonToAgent(agentKey, {
            type: "rdp.open",
            sessionId,
            host: targetHost,
            port: targetPort,
        });

        return { sessionId, localPort: session.localPort };
    }

    markReady(sessionId: string) {
        const s = RemoteDesktopService.SESSIONS.get(sessionId);
        if (!s || s.state === "closed") return;
        s.state = "ready";
        s.lastActivityAt = Date.now();
    }

    markError(sessionId: string, code: string, message: string) {
        const s = RemoteDesktopService.SESSIONS.get(sessionId);
        if (!s || s.state === "closed") return;
        s.state = "error";
        s.error = { code, message };
        s.lastActivityAt = Date.now();
    }

    receiveBinaryFromAgent(sessionId: string, payload: Uint8Array) {
        const s = RemoteDesktopService.SESSIONS.get(sessionId);
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
        const agentKey = normAgentKey(agentUuid);
        const ws = this.getAgentWs(agentKey);
        if (!ws || (ws as any).readyState !== WS_OPEN) {
            this.endSession(sessionId, "agent_not_connected");
            return;
        }

        const framed = encodeDataFrame(sessionId, payload);
        try {
            ws.send(framed);
        } catch (e: any) {
            this.logger.warn(`ws send failed agent=${agentKey} session=${sessionId}: ${e?.message || e}`);
            this.endSession(sessionId, "ws_send_failed");
        }
    }

    sendJsonToAgent(agentUuid: string, msg: any) {
        const agentKey = normAgentKey(agentUuid);
        const ws = this.getAgentWs(agentKey);
        if (!ws || (ws as any).readyState !== WS_OPEN) return;
        try {
            ws.send(JSON.stringify(msg));
        } catch {
            // ignore
        }
    }

    endSession(sessionId: string, reason: string) {
        const s = RemoteDesktopService.SESSIONS.get(sessionId);
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

        RemoteDesktopService.SESSIONS.delete(sessionId);
        this.logger.log(`session ended ${sessionId} (${reason})`);
    }

    handleAgentClosed(sessionId: string, reason?: string) {
        this.endSession(sessionId, reason || "agent_closed");
    }

    handlePong(agentUuid: string, ts: number) {
        this.logger.debug?.(`pong agent=${normAgentKey(agentUuid)} ts=${ts}`);
    }

    // (Kept for API symmetry; real cleanup is done via the static timer)
    private cleanupOrphans() {
        const now = Date.now();
        for (const s of RemoteDesktopService.SESSIONS.values()) {
            if (s.state === "closed") continue;
            if (now - s.lastActivityAt > this.SESSION_IDLE_MS) {
                this.endSession(s.sessionId, "idle_timeout");
            }
        }
    }
}
