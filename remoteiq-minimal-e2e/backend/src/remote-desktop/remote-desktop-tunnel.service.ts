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
    agentUuid: string;

    state: TunnelState;
    createdAt: number;
    lastActivityAt: number;

    target: TunnelTarget;

    // local TCP server that guacd (later) connects to
    server: net.Server;
    localPort: number;

    // active TCP client (guacd side) once connected
    tcpSocket: net.Socket | null;

    // if open failed
    error?: string;

    // awaiting ready
    readyResolve?: () => void;
    readyReject?: (err: Error) => void;
    readyTimer?: NodeJS.Timeout;
};

const WS_OPEN = 1;

function wsSendJson(ws: WebSocket, msg: any) {
    if ((ws as any).readyState === WS_OPEN) {
        try {
            ws.send(JSON.stringify(msg));
        } catch {
            // ignore
        }
    }
}

function wsSendBinary(ws: WebSocket, data: Uint8Array) {
    if ((ws as any).readyState === WS_OPEN) {
        try {
            ws.send(data, { binary: true });
        } catch {
            // ignore
        }
    }
}

@Injectable()
export class RemoteDesktopTunnelService {
    private readonly logger = new Logger("RemoteDesktopTunnelService");

    // agentUuid -> ws
    private readonly agents = new Map<string, WebSocket>();

    // sessionId -> session
    private readonly sessions = new Map<string, TunnelSession>();

    // Policy: one session per device/agentUuid (deny second by default)
    private readonly sessionByAgent = new Map<string, string>();

    // ---------------- Debug / visibility ----------------

    listConnectedAgents(): string[] {
        return Array.from(this.agents.keys());
    }

    listSessions() {
        return Array.from(this.sessions.values()).map((s) => ({
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

    // ---------------- Agent lifecycle ----------------

    registerAgent(agentUuid: string, ws: WebSocket) {
        const existing = this.agents.get(agentUuid);
        if (existing && existing !== ws) {
            try {
                existing.close();
            } catch {
                // ignore
            }
        }

        this.agents.set(agentUuid, ws);
        this.logger.log(`Desktop tunnel agent registered: ${agentUuid}`);
    }

    unregisterAgent(agentUuid: string, ws: WebSocket) {
        const cur = this.agents.get(agentUuid);
        if (cur === ws) this.agents.delete(agentUuid);

        // end any sessions for this agent
        const sid = this.sessionByAgent.get(agentUuid);
        if (sid) {
            this.logger.warn(`Agent disconnected; closing desktop tunnel session ${sid}`);
            void this.closeTunnel(sid, "agent_disconnected");
        }
    }

    // Called by the gateway when the agent sends TEXT JSON control messages
    handleAgentText(agentUuid: string, msg: any) {
        const type = String(msg?.type || "");

        if (type === "pong") return;

        if (type === "rdp.ready") {
            const sessionId = String(msg?.sessionId || "");
            const sess = this.sessions.get(sessionId);
            if (!sess || sess.agentUuid !== agentUuid) return;

            sess.state = "ready";
            sess.lastActivityAt = Date.now();

            if (sess.readyTimer) {
                clearTimeout(sess.readyTimer);
                sess.readyTimer = undefined;
            }
            if (sess.readyResolve) {
                sess.readyResolve();
                sess.readyResolve = undefined;
                sess.readyReject = undefined;
            }

            this.logger.log(
                `Tunnel ready: agent=${agentUuid} session=${sessionId} localPort=${sess.localPort}`
            );
            return;
        }

        if (type === "rdp.error") {
            const sessionId = String(msg?.sessionId || "");
            const message = String(msg?.message || "RDP tunnel error");
            const sess = this.sessions.get(sessionId);
            if (!sess || sess.agentUuid !== agentUuid) return;

            sess.state = "error";
            sess.error = message;
            sess.lastActivityAt = Date.now();

            if (sess.readyTimer) {
                clearTimeout(sess.readyTimer);
                sess.readyTimer = undefined;
            }
            if (sess.readyReject) {
                sess.readyReject(new Error(message));
                sess.readyResolve = undefined;
                sess.readyReject = undefined;
            }

            this.logger.warn(`Tunnel error: agent=${agentUuid} session=${sessionId} msg=${message}`);
            void this.closeTunnel(sessionId, "agent_error");
            return;
        }

        if (type === "rdp.closed") {
            const sessionId = String(msg?.sessionId || "");
            const reason = String(msg?.reason || "closed");
            const sess = this.sessions.get(sessionId);
            if (!sess || sess.agentUuid !== agentUuid) return;

            this.logger.log(`Tunnel closed by agent: session=${sessionId} reason=${reason}`);
            void this.closeTunnel(sessionId, `agent_closed:${reason}`);
            return;
        }
    }

    // Called by the gateway when the agent sends BINARY frames
    handleAgentBinary(agentUuid: string, raw: any) {
        const buf = toUint8(raw);
        if (!buf) return;

        let frame: { sessionId: string; payload: Uint8Array };
        try {
            frame = decodeRdpDataFrame(buf);
        } catch {
            return;
        }

        const sess = this.sessions.get(frame.sessionId);
        if (!sess) return;
        if (sess.agentUuid !== agentUuid) return;

        sess.lastActivityAt = Date.now();

        const sock = sess.tcpSocket;
        if (!sock || sock.destroyed) return;

        try {
            sock.write(frame.payload);
        } catch {
            // ignore
        }
    }

    // ---------------- Session API (called by controller/dev endpoints) ----------------

    async openTunnel(
        agentUuid: string,
        target: TunnelTarget
    ): Promise<{ sessionId: string; localPort: number }> {
        const agent = this.agents.get(agentUuid);
        if (!agent) {
            this.logger.warn(
                `Agent not connected: requested=${agentUuid} connected=[${this.listConnectedAgents().join(
                    ", "
                )}]`
            );
            throw new Error("Agent not connected");
        }

        // one-session-per-device policy
        const existing = this.sessionByAgent.get(agentUuid);
        if (existing) {
            throw new Error("A desktop tunnel session is already active for this device.");
        }

        const sessionId = randomUUID();

        // Create a local ephemeral TCP server
        const server = net.createServer();

        const sess: TunnelSession = {
            sessionId,
            agentUuid,
            state: "opening",
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            target,
            server,
            localPort: 0,
            tcpSocket: null,
        };

        this.sessions.set(sessionId, sess);
        this.sessionByAgent.set(agentUuid, sessionId);

        // Accept only ONE TCP client (guacd) at a time
        server.on("connection", (sock) => {
            // replace old socket if any
            if (sess.tcpSocket && !sess.tcpSocket.destroyed) {
                try {
                    sess.tcpSocket.destroy();
                } catch {
                    // ignore
                }
            }

            sess.tcpSocket = sock;
            sess.lastActivityAt = Date.now();

            this.logger.log(
                `TCP client connected: session=${sessionId} from=${sock.remoteAddress}:${sock.remotePort}`
            );

            sock.on("data", (chunk: Buffer | Uint8Array) => {
                sess.lastActivityAt = Date.now();
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                const framed = encodeRdpDataFrame(sessionId, u8);
                wsSendBinary(agent, framed);
            });

            sock.on("error", () => {
                // ignore
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

        // Bind on localhost only
        await new Promise<void>((resolve, reject) => {
            server.listen(0, "127.0.0.1", () => resolve());
            server.once("error", reject);
        });

        const addr = server.address();
        if (!addr || typeof addr === "string") {
            await this.closeTunnel(sessionId, "tcp_listen_failed");
            throw new Error("Failed to bind local TCP port");
        }

        sess.localPort = addr.port;

        // Ask agent to open TCP -> target.host:target.port
        const readyPromise = new Promise<void>((resolve, reject) => {
            sess.readyResolve = resolve;
            sess.readyReject = reject;

            sess.readyTimer = setTimeout(() => {
                sess.readyTimer = undefined;
                reject(new Error("Agent did not acknowledge tunnel open (timeout)."));
            }, 15_000);
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
        const sess = this.sessions.get(sessionId);
        if (!sess) return;

        this.sessions.delete(sessionId);
        this.sessionByAgent.delete(sess.agentUuid);

        sess.state = "closed";
        sess.lastActivityAt = Date.now();

        if (sess.readyTimer) {
            clearTimeout(sess.readyTimer);
            sess.readyTimer = undefined;
        }

        // tell agent to close
        const agent = this.agents.get(sess.agentUuid);
        if (agent) {
            wsSendJson(agent, { type: "rdp.close", sessionId, reason });
        }

        // close tcp client
        if (sess.tcpSocket) {
            try {
                sess.tcpSocket.destroy();
            } catch {
                // ignore
            }
            sess.tcpSocket = null;
        }

        // close server
        try {
            await new Promise<void>((resolve) => {
                sess.server.close(() => resolve());
            });
        } catch {
            // ignore
        }

        this.logger.log(`Tunnel closed: agent=${sess.agentUuid} session=${sessionId} reason=${reason}`);
    }

    sendPing(agentUuid: string) {
        const ws = this.agents.get(agentUuid);
        if (!ws) return;
        wsSendJson(ws, { type: "ping", ts: Date.now() });
    }
}
