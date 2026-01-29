// remoteiq-minimal-e2e/backend/src/remote-shell/remote-shell.gateway.ts
import { Logger, OnModuleDestroy } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { Server } from "ws";

type Role = "ui" | "agent";
type RunAs = "system" | "user";

type UiOpen = { type: "open"; cols?: number; rows?: number; runAs?: RunAs };
type UiInput = { type: "input"; sessionId: string; data: string };
type UiSignal = { type: "signal"; sessionId: string; signal: "SIGINT" | "SIGTERM" };
type UiResize = { type: "resize"; sessionId: string; cols: number; rows: number };
type UiClose = { type: "close"; sessionId: string };
type UiToServer = UiOpen | UiInput | UiSignal | UiResize | UiClose;

type AgentHello = { type: "hello"; agentUuid?: string; token?: string };
type AgentReady = { type: "shell.ready"; sessionId: string };
type AgentData = { type: "shell.data"; sessionId: string; data: string };
type AgentExit = { type: "shell.exit"; sessionId: string; code?: number; signal?: string; message?: string };
type AgentError = { type: "shell.error"; sessionId?: string; message: string };
type AgentToServer = AgentHello | AgentReady | AgentData | AgentExit | AgentError;

type ServerToUi =
    | {
        type: "status";
        status: "connected" | "waiting_for_agent" | "agent_connected" | "agent_disconnected";
        agentUuid: string;
    }
    | { type: "session"; sessionId: string; agentUuid: string }
    | { type: "data"; sessionId: string; data: string }
    | { type: "exit"; sessionId: string; code?: number; signal?: string; message?: string }
    | { type: "error"; message: string };

type ServerToAgent =
    | { type: "shell.open"; sessionId: string; cols?: number; rows?: number; runAs?: RunAs }
    | { type: "shell.input"; sessionId: string; data: string }
    | { type: "shell.signal"; sessionId: string; signal: "SIGINT" | "SIGTERM" }
    | { type: "shell.resize"; sessionId: string; cols: number; rows: number }
    | { type: "shell.close"; sessionId: string };

const WS_OPEN = 1;

function safeJsonParse(s: string): any | null {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function wsSend(ws: WebSocket, msg: any) {
    if ((ws as any).readyState === WS_OPEN) {
        try {
            ws.send(JSON.stringify(msg));
        } catch {
            // ignore
        }
    }
}

function getQuery(req: IncomingMessage): URLSearchParams {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    return url.searchParams;
}

@WebSocketGateway({
    path: "/ws/shell",
})
export class RemoteShellGateway implements OnModuleDestroy {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger("RemoteShellGateway");

    private agentsByAgentUuid = new Map<string, WebSocket>();
    private uiAgentBySocket = new Map<WebSocket, string>();

    private sessions = new Map<string, { agentUuid: string; ui: WebSocket }>();

    private heartbeatTimer: NodeJS.Timeout | null = null;

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
        const q = getQuery(req);
        const role = ((q.get("role") as Role) || "ui").trim() as Role;
        const agentUuid = (q.get("agentUuid") || "").trim();

        if (role !== "ui" && role !== "agent") {
            wsSend(client, { type: "error", message: "Invalid role" } satisfies ServerToUi);
            try {
                client.close();
            } catch { }
            return;
        }

        if (!agentUuid) {
            wsSend(client, { type: "error", message: "Missing agentUuid" } satisfies ServerToUi);
            try {
                client.close();
            } catch { }
            return;
        }

        // tag socket
        (client as any).__role = role;
        (client as any).__agentUuid = agentUuid;

        (client as any).on("message", (raw: any) => {
            const text = typeof raw === "string" ? raw : raw?.toString ? raw.toString("utf8") : "";
            const msg = safeJsonParse(text);
            if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
                wsSend(client, { type: "error", message: "Invalid message" } satisfies ServerToUi);
                return;
            }

            const r = ((client as any).__role as Role) || "ui";
            if (r === "agent") this.handleAgentMessage(client, msg as AgentToServer);
            else this.handleUiMessage(client, msg as UiToServer);
        });

        (client as any).on("close", () => {
            this.handleDisconnect(client);
        });

        if (role === "agent") {
            const existing = this.agentsByAgentUuid.get(agentUuid);
            if (existing && existing !== client) {
                try {
                    existing.close();
                } catch { }
            }

            this.agentsByAgentUuid.set(agentUuid, client);
            this.logger.log(`Agent connected for agentUuid ${agentUuid}`);

            for (const [uiSock, uiAgent] of this.uiAgentBySocket.entries()) {
                if (uiAgent === agentUuid) {
                    wsSend(uiSock, { type: "status", status: "agent_connected", agentUuid } satisfies ServerToUi);
                }
            }

            return;
        }

        // UI role
        this.uiAgentBySocket.set(client, agentUuid);

        const hasAgent = this.agentsByAgentUuid.has(agentUuid);
        wsSend(client, {
            type: "status",
            status: hasAgent ? "agent_connected" : "waiting_for_agent",
            agentUuid,
        } satisfies ServerToUi);

        this.logger.log(`UI connected for agentUuid ${agentUuid}`);
    }

    handleDisconnect(client: WebSocket) {
        const role = ((client as any).__role as Role) || "ui";
        const agentUuid = String((client as any).__agentUuid || "");

        if (role === "agent") {
            const sock = this.agentsByAgentUuid.get(agentUuid);
            if (sock === client) {
                this.agentsByAgentUuid.delete(agentUuid);
                this.logger.log(`Agent disconnected for agentUuid ${agentUuid}`);

                for (const [uiSock, uiAgent] of this.uiAgentBySocket.entries()) {
                    if (uiAgent === agentUuid) {
                        wsSend(uiSock, { type: "status", status: "agent_disconnected", agentUuid } satisfies ServerToUi);
                    }
                }

                for (const [sid, sess] of this.sessions.entries()) {
                    if (sess.agentUuid === agentUuid) {
                        wsSend(sess.ui, { type: "exit", sessionId: sid, message: "Agent disconnected." } satisfies ServerToUi);
                        this.sessions.delete(sid);
                    }
                }
            }
            return;
        }

        // UI disconnect
        if (agentUuid) {
            this.uiAgentBySocket.delete(client);

            for (const [sid, sess] of this.sessions.entries()) {
                if (sess.ui === client) {
                    const agent = this.agentsByAgentUuid.get(sess.agentUuid);
                    if (agent) wsSend(agent, { type: "shell.close", sessionId: sid } satisfies ServerToAgent);
                    this.sessions.delete(sid);
                }
            }
        }
    }

    private handleUiMessage(ui: WebSocket, msg: UiToServer) {
        const agentUuid = this.uiAgentBySocket.get(ui);
        if (!agentUuid) {
            wsSend(ui, { type: "error", message: "UI socket not registered" } satisfies ServerToUi);
            return;
        }

        const agent = this.agentsByAgentUuid.get(agentUuid);

        switch (msg.type) {
            case "open": {
                if (!agent) {
                    wsSend(ui, { type: "error", message: "Agent not connected for this agentUuid." } satisfies ServerToUi);
                    return;
                }

                // Policy: one active shell per device (agentUuid)
                for (const [, s] of this.sessions.entries()) {
                    if (s.agentUuid === agentUuid) {
                        wsSend(ui, { type: "error", message: "A shell session is already active for this device." } satisfies ServerToUi);
                        return;
                    }
                }

                const runAs: RunAs = msg.runAs === "user" ? "user" : "system";

                const sessionId = randomUUID();
                this.sessions.set(sessionId, { agentUuid, ui });

                this.logger.log(`Shell open: agent=${agentUuid} session=${sessionId} runAs=${runAs}`);

                wsSend(ui, { type: "session", sessionId, agentUuid } satisfies ServerToUi);

                wsSend(agent, {
                    type: "shell.open",
                    sessionId,
                    cols: msg.cols,
                    rows: msg.rows,
                    runAs,
                } satisfies ServerToAgent);
                return;
            }

            case "input": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess || sess.ui !== ui) {
                    wsSend(ui, { type: "error", message: "Unknown session" } satisfies ServerToUi);
                    return;
                }
                const a = this.agentsByAgentUuid.get(sess.agentUuid);
                if (!a) {
                    wsSend(ui, { type: "error", message: "Agent disconnected" } satisfies ServerToUi);
                    return;
                }
                wsSend(a, { type: "shell.input", sessionId: msg.sessionId, data: msg.data } satisfies ServerToAgent);
                return;
            }

            case "signal": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess || sess.ui !== ui) {
                    wsSend(ui, { type: "error", message: "Unknown session" } satisfies ServerToUi);
                    return;
                }
                const a = this.agentsByAgentUuid.get(sess.agentUuid);
                if (!a) {
                    wsSend(ui, { type: "error", message: "Agent disconnected" } satisfies ServerToUi);
                    return;
                }
                wsSend(a, { type: "shell.signal", sessionId: msg.sessionId, signal: msg.signal } satisfies ServerToAgent);
                return;
            }

            case "resize": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess || sess.ui !== ui) return;
                const a = this.agentsByAgentUuid.get(sess.agentUuid);
                if (!a) return;
                wsSend(a, { type: "shell.resize", sessionId: msg.sessionId, cols: msg.cols, rows: msg.rows } satisfies ServerToAgent);
                return;
            }

            case "close": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess || sess.ui !== ui) return;

                const a = this.agentsByAgentUuid.get(sess.agentUuid);
                if (a) wsSend(a, { type: "shell.close", sessionId: msg.sessionId } satisfies ServerToAgent);

                this.sessions.delete(msg.sessionId);

                this.logger.log(`Shell close: agent=${sess.agentUuid} session=${msg.sessionId}`);

                wsSend(ui, { type: "exit", sessionId: msg.sessionId, message: "Session closed." } satisfies ServerToUi);
                return;
            }
        }
    }

    private handleAgentMessage(_agent: WebSocket, msg: AgentToServer) {
        switch (msg.type) {
            case "hello":
                return;

            case "shell.ready": {
                // Optional: you could forward a "ready" status, but session is already emitted to UI.
                return;
            }

            case "shell.data": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess) return;
                wsSend(sess.ui, { type: "data", sessionId: msg.sessionId, data: msg.data } satisfies ServerToUi);
                return;
            }

            case "shell.exit": {
                const sess = this.sessions.get(msg.sessionId);
                if (!sess) return;
                wsSend(sess.ui, {
                    type: "exit",
                    sessionId: msg.sessionId,
                    code: msg.code,
                    signal: msg.signal,
                    message: msg.message,
                } satisfies ServerToUi);
                this.sessions.delete(msg.sessionId);

                this.logger.log(`Shell exit: agent=${sess.agentUuid} session=${msg.sessionId} code=${msg.code ?? ""} signal=${msg.signal ?? ""}`);

                return;
            }

            case "shell.error": {
                if (msg.sessionId) {
                    const sess = this.sessions.get(msg.sessionId);
                    if (sess) {
                        wsSend(sess.ui, { type: "error", message: msg.message } satisfies ServerToUi);
                        wsSend(sess.ui, { type: "exit", sessionId: msg.sessionId, message: msg.message } satisfies ServerToUi);
                        this.sessions.delete(msg.sessionId);

                        this.logger.log(`Shell error: agent=${sess.agentUuid} session=${msg.sessionId} message=${msg.message}`);
                    }
                }
                return;
            }
        }
    }
}
