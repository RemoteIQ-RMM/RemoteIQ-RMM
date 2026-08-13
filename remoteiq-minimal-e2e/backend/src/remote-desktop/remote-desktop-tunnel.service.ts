// backend/src/remote-desktop/remote-desktop-tunnel.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import type WebSocket from "ws";

import { decodeRdpDataFrame, encodeRdpDataFrame, toUint8 } from "./rdp-tunnel.framing";

type TunnelState = "opening" | "ready" | "error" | "closed";
type TunnelTarget = { host: string; port: number };

type TunnelSession = {
    sessionId: string;
    agentUuid: string; // canonical agent id (string)

    state: TunnelState;
    createdAt: number;
    lastActivityAt: number;

    target: TunnelTarget;

    server: net.Server;
    localPort: number;

    tcpSocket: net.Socket | null;

    error?: string;

    readyResolve?: () => void;
    readyReject?: (err: Error) => void;
    readyTimer?: NodeJS.Timeout;
};

const WS_OPEN = 1;

function normKey(v: string) {
    return String(v || "").trim().toLowerCase();
}

function wsSendJson(ws: WebSocket, msg: any) {
    if ((ws as any).readyState !== WS_OPEN) return;
    try {
        ws.send(JSON.stringify(msg));
    } catch {
        // ignore
    }
}

function wsSendBinary(ws: WebSocket, data: Uint8Array) {
    if ((ws as any).readyState !== WS_OPEN) return;
    try {
        ws.send(data, { binary: true });
    } catch {
        // ignore
    }
}

@Injectable()
export class RemoteDesktopTunnelService {
    private readonly logger = new Logger("RemoteDesktopTunnelService");

    /**
     * IMPORTANT:
     * If this service is accidentally provided in multiple modules, Nest can instantiate it twice.
     * Instance-local Maps then diverge -> you get "Agent not connected" while the gateway logs auth.
     *
     * To harden against that, keep registries static so ALL instances share the same state.
     */
    private static readonly AGENTS = new Map<string, WebSocket>(); // agentKey -> ws
    private static readonly SESSIONS = new Map<string, TunnelSession>(); // sessionId -> session
    private static readonly SESSION_BY_AGENT = new Map<string, string>(); // agentKey -> sessionId

    private static cleanerStarted = false;

    // Policy
    private readonly READY_TIMEOUT_MS = 15_000;
    private readonly IDLE_TIMEOUT_MS = 5 * 60_000;

    constructor() {
        if (!RemoteDesktopTunnelService.cleanerStarted) {
            RemoteDesktopTunnelService.cleanerStarted = true;

            setInterval(() => {
                const now = Date.now();
                for (const s of RemoteDesktopTunnelService.SESSIONS.values()) {
                    if (s.state === "closed") continue;
                    if (now - s.lastActivityAt > 5 * 60_000) {
                        // best-effort cleanup without relying on instance state
                        try {
                            if (s.tcpSocket && !s.tcpSocket.destroyed) s.tcpSocket.destroy();
                        } catch { }
                        try {
                            if (s.server) s.server.close();
                        } catch { }

                        RemoteDesktopTunnelService.SESSIONS.delete(s.sessionId);
                        RemoteDesktopTunnelService.SESSION_BY_AGENT.delete(normKey(s.agentUuid));
                    }
                }
            }, 30_000).unref();
        }
    }

    // ---------------- Debug / visibility ----------------

    listConnectedAgents(): string[] {
        return Array.from(RemoteDesktopTunnelService.AGENTS.keys());
    }

    listSessions() {
        return Array.from(RemoteDesktopTunnelService.SESSIONS.values()).map((s) => ({
            sessionId: s.sessionId,
            agentUuid: s.agentUuid,
            state: s.state,
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            localPort: s.localPort,
            error: s.error ?? "",
            target: s.target,
        }));
    }

    private getAgentWs(agentUuid: string): WebSocket | undefined {
        const key = normKey(agentUuid);
        if (!key) return undefined;
        return RemoteDesktopTunnelService.AGENTS.get(key);
    }

    // ---------------- Agent lifecycle ----------------

    registerAgent(agentUuid: string, ws: WebSocket) {
        const key = normKey(agentUuid);
        if (!key) return;

        const existing = RemoteDesktopTunnelService.AGENTS.get(key);
        if (existing && existing !== ws) {
            try {
                existing.close();
            } catch {
                // ignore
            }
        }

        RemoteDesktopTunnelService.AGENTS.set(key, ws);
        this.logger.log(`Desktop tunnel agent registered: ${agentUuid} (key=${key})`);
    }

    unregisterAgent(agentUuid: string, ws: WebSocket) {
        const key = normKey(agentUuid);
        if (!key) return;

        const cur = RemoteDesktopTunnelService.AGENTS.get(key);
        if (cur === ws) RemoteDesktopTunnelService.AGENTS.delete(key);

        const sid = RemoteDesktopTunnelService.SESSION_BY_AGENT.get(key);
        if (sid) {
            this.logger.warn(`Agent disconnected; closing desktop tunnel session ${sid}`);
            void this.closeTunnel(sid, "agent_disconnected");
        }
    }

    // Called by the gateway when the agent sends TEXT JSON control messages
    handleAgentText(agentUuid: string, msg: any) {
        const agentKey = normKey(agentUuid);
        const type = String(msg?.type || "");

        if (!agentKey) return;
        if (type === "pong") return;

        if (type === "rdp.ready") {
            const sessionId = String(msg?.sessionId || "");
            const sess = RemoteDesktopTunnelService.SESSIONS.get(sessionId);
            if (!sess || normKey(sess.agentUuid) !== agentKey) return;
            if (sess.state === "closed") return;

            sess.state = "ready";
            sess.lastActivityAt = Date.now();

            if (sess.readyTimer) {
                clearTimeout(sess.readyTimer);
                sess.readyTimer = undefined;
            }

            const resolve = sess.readyResolve;
            sess.readyResolve = undefined;
            sess.readyReject = undefined;

            try {
                resolve?.();
            } catch {
                // ignore
            }

            this.logger.log(
                `Tunnel ready: agent=${sess.agentUuid} session=${sessionId} localPort=${sess.localPort}`
            );
            return;
        }

        if (type === "rdp.error") {
            const sessionId = String(msg?.sessionId || "");
            const message = String(msg?.message || "RDP tunnel error");
            const sess = RemoteDesktopTunnelService.SESSIONS.get(sessionId);
            if (!sess || normKey(sess.agentUuid) !== agentKey) return;
            if (sess.state === "closed") return;

            sess.state = "error";
            sess.error = message;
            sess.lastActivityAt = Date.now();

            if (sess.readyTimer) {
                clearTimeout(sess.readyTimer);
                sess.readyTimer = undefined;
            }

            const reject = sess.readyReject;
            sess.readyResolve = undefined;
            sess.readyReject = undefined;

            try {
                reject?.(new Error(message));
            } catch {
                // ignore
            }

            this.logger.warn(`Tunnel error: agent=${sess.agentUuid} session=${sessionId} msg=${message}`);
            void this.closeTunnel(sessionId, "agent_error");
            return;
        }

        if (type === "rdp.closed") {
            const sessionId = String(msg?.sessionId || "");
            const reason = String(msg?.reason || "closed");
            const sess = RemoteDesktopTunnelService.SESSIONS.get(sessionId);
            if (!sess || normKey(sess.agentUuid) !== agentKey) return;

            this.logger.log(`Tunnel closed by agent: session=${sessionId} reason=${reason}`);
            void this.closeTunnel(sessionId, `agent_closed:${reason}`);
            return;
        }
    }

    // Called by the gateway when the agent sends BINARY frames
    handleAgentBinary(agentUuid: string, raw: any) {
        const agentKey = normKey(agentUuid);
        if (!agentKey) return;

        const buf = toUint8(raw);
        if (!buf) return;

        let frame: { sessionId: string; payload: Uint8Array };
        try {
            frame = decodeRdpDataFrame(buf);
        } catch {
            return;
        }

        const sess = RemoteDesktopTunnelService.SESSIONS.get(frame.sessionId);
        if (!sess) return;
        if (normKey(sess.agentUuid) !== agentKey) return;
        if (sess.state === "closed") return;

        sess.lastActivityAt = Date.now();

        const sock = sess.tcpSocket;
        if (!sock || sock.destroyed) return;

        try {
            sock.write(frame.payload);
        } catch {
            // if TCP is broken, kill session
            void this.closeTunnel(sess.sessionId, "tcp_write_failed");
        }
    }

    // ---------------- Session API ----------------

    async openTunnel(agentUuid: string, target: TunnelTarget): Promise<{ sessionId: string; localPort: number }> {
        const agentKey = normKey(agentUuid);
        const agent = this.getAgentWs(agentKey);

        if (!agent || (agent as any).readyState !== WS_OPEN) {
            this.logger.warn(
                `Agent not connected: requested=${agentUuid} (key=${agentKey}) connected=[${this.listConnectedAgents().join(", ")}]`
            );
            throw new Error("Agent not connected");
        }

        const existing = RemoteDesktopTunnelService.SESSION_BY_AGENT.get(agentKey);
        if (existing) {
            throw new Error("A desktop tunnel session is already active for this device.");
        }

        const sessionId = randomUUID();

        const server = net.createServer();

        const sess: TunnelSession = {
            sessionId,
            agentUuid: agentKey, // store normalized key (stable for maps)
            state: "opening",
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            target,
            server,
            localPort: 0,
            tcpSocket: null,
        };

        RemoteDesktopTunnelService.SESSIONS.set(sessionId, sess);
        RemoteDesktopTunnelService.SESSION_BY_AGENT.set(agentKey, sessionId);

        // Accept only ONE TCP client at a time
        server.on("connection", (sock) => {
            // If one is already connected, reject the new one (do NOT kill the existing stream).
            if (sess.tcpSocket && !sess.tcpSocket.destroyed) {
                try {
                    sock.destroy();
                } catch { }
                return;
            }

            sess.tcpSocket = sock;
            sess.lastActivityAt = Date.now();

            this.logger.log(
                `TCP client connected: session=${sessionId} from=${sock.remoteAddress}:${sock.remotePort}`
            );

            sock.on("data", (chunk: Buffer | Uint8Array) => {
                sess.lastActivityAt = Date.now();
                // Buffer is Uint8Array in Node; this keeps it as bytes without copies where possible.
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                const framed = encodeRdpDataFrame(sessionId, u8);
                wsSendBinary(agent, framed);
            });

            sock.on("error", (err) => {
                this.logger.warn(`TCP socket error session=${sessionId}: ${(err as any)?.message || err}`);
                void this.closeTunnel(sessionId, "tcp_socket_error");
            });

            sock.on("close", () => {
                this.logger.log(`TCP client closed: session=${sessionId}`);
                void this.closeTunnel(sessionId, "tcp_closed");
            });
        });

        server.on("error", (err) => {
            this.logger.error(`TCP server error session=${sessionId}: ${(err as any)?.message || err}`);
            void this.closeTunnel(sessionId, "tcp_server_error");
        });

        await new Promise<void>((resolve, reject) => {
            const onErr = (e: any) => reject(e);
            server.once("error", onErr);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", onErr);
                resolve();
            });
        });

        const addr = server.address();
        if (!addr || typeof addr === "string") {
            await this.closeTunnel(sessionId, "tcp_listen_failed");
            throw new Error("Failed to bind local TCP port");
        }

        sess.localPort = addr.port;

        const readyPromise = new Promise<void>((resolve, reject) => {
            sess.readyResolve = resolve;
            sess.readyReject = reject;

            sess.readyTimer = setTimeout(() => {
                sess.readyTimer = undefined;

                // clear handlers so we don't resolve/reject after timeout
                sess.readyResolve = undefined;
                sess.readyReject = undefined;

                reject(new Error("Agent did not acknowledge tunnel open (timeout)."));
            }, this.READY_TIMEOUT_MS).unref?.() ?? sess.readyTimer;
        });

        wsSendJson(agent, {
            type: "rdp.open",
            sessionId,
            host: target.host,
            port: target.port,
        });

        try {
            await readyPromise;
        } catch (e: any) {
            await this.closeTunnel(sessionId, "agent_ready_timeout_or_error");
            throw e;
        }

        return { sessionId, localPort: sess.localPort };
    }

    async closeTunnel(sessionId: string, reason = "closed") {
        const sess = RemoteDesktopTunnelService.SESSIONS.get(sessionId);
        if (!sess) return;
        if (sess.state === "closed") return;

        sess.state = "closed";
        sess.lastActivityAt = Date.now();

        RemoteDesktopTunnelService.SESSIONS.delete(sessionId);
        RemoteDesktopTunnelService.SESSION_BY_AGENT.delete(normKey(sess.agentUuid));

        if (sess.readyTimer) {
            clearTimeout(sess.readyTimer);
            sess.readyTimer = undefined;
        }
        sess.readyResolve = undefined;
        sess.readyReject = undefined;

        const agent = this.getAgentWs(sess.agentUuid);
        if (agent) {
            wsSendJson(agent, { type: "rdp.close", sessionId, reason });
        }

        if (sess.tcpSocket) {
            try {
                sess.tcpSocket.destroy();
            } catch {
                // ignore
            }
            sess.tcpSocket = null;
        }

        try {
            await new Promise<void>((resolve) => {
                // if server was never fully listening, close() can throw; we guard with try/catch around the await
                sess.server.close(() => resolve());
            });
        } catch {
            // ignore
        }

        this.logger.log(`Tunnel closed: agent=${sess.agentUuid} session=${sessionId} reason=${reason}`);
    }

    sendPing(agentUuid: string) {
        const ws = this.getAgentWs(agentUuid);
        if (!ws) return;
        wsSendJson(ws, { type: "ping", ts: Date.now() });
    }

    // Optional: used by other parts if you want manual cleanup (static timer also runs)
    cleanupIdleSessionsBestEffort() {
        const now = Date.now();
        for (const s of RemoteDesktopTunnelService.SESSIONS.values()) {
            if (s.state === "closed") continue;
            if (now - s.lastActivityAt > this.IDLE_TIMEOUT_MS) {
                void this.closeTunnel(s.sessionId, "idle_timeout");
            }
        }
    }
}
