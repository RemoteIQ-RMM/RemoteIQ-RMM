// backend/src/remote-console/remote-console.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type WebSocket from "ws";

import { PgPoolService } from "../storage/pg-pool.service";
import type { ConsoleSession, ConsolePeerKind, WsServerToClient } from "./remote-console.types";

const WS_OPEN = 1;

// 15 minutes session token validity by default
const DEFAULT_TOKEN_TTL_MS = 15 * 60_000;
// cleanup idle sessions
const DEFAULT_IDLE_TTL_MS = 10 * 60_000;

function safeJsonParse(text: string): any | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
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

function wsReady(ws?: WebSocket) {
    return !!ws && (ws as any).readyState === WS_OPEN;
}

function wsSend(ws: WebSocket | undefined, msg: WsServerToClient) {
    if (!wsReady(ws)) return;
    try {
        (ws as any).send(JSON.stringify(msg));
    } catch {
        // ignore
    }
}

@Injectable()
export class RemoteConsoleService {
    private readonly logger = new Logger("RemoteConsole");

    /**
     * We use static registries so we don't get bitten if Nest accidentally
     * instantiates the service twice in dev/hot-reload edge cases.
     */
    private static readonly SESSIONS = new Map<string, ConsoleSession>();
    private static readonly AGENTS = new Map<string, WebSocket>(); // agentId -> ws
    private static cleanerStarted = false;

    private readonly tokenTtlMs =
        Number(process.env.REMOTE_CONSOLE_TOKEN_TTL_MS || "") || DEFAULT_TOKEN_TTL_MS;

    private readonly idleTtlMs =
        Number(process.env.REMOTE_CONSOLE_IDLE_TTL_MS || "") || DEFAULT_IDLE_TTL_MS;

    constructor(private readonly pg: PgPoolService) {
        if (!RemoteConsoleService.cleanerStarted) {
            RemoteConsoleService.cleanerStarted = true;
            setInterval(() => this.cleanup(), 30_000).unref();
        }
    }

    // ---------------- Debug helpers ----------------

    listSessions() {
        return Array.from(RemoteConsoleService.SESSIONS.values()).map((s) => ({
            sessionId: s.sessionId,
            agentId: s.agentId,
            state: s.state,
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            hasAgent: wsReady(s.agentWs),
            hasTech: wsReady(s.techWs),
            error: s.error ?? null,
        }));
    }

    listConnectedAgents() {
        return Array.from(RemoteConsoleService.AGENTS.keys());
    }

    // ---------------- Session creation (REST) ----------------

    /**
     * Called by the TECH UI via REST:
     * - Validates agent exists
     * - Creates sessionId + one-time sessionToken for WS hello
     */
    async createSession(
        agentIdOrUuid: string
    ): Promise<{ sessionId: string; sessionToken: string }> {
        const raw = String(agentIdOrUuid || "").trim();
        if (!raw) throw new Error("Missing agent id");

        // Resolve canonical agents.id
        const found = await this.pg.query<{ id: string }>(
            `
      SELECT id::text AS id
      FROM public.agents
      WHERE id::text = $1 OR agent_uuid::text = $1
      LIMIT 1
      `,
            [raw]
        );

        const agentId = found.rows?.[0]?.id;
        if (!agentId) throw new Error("Unknown agent");

        const sessionId = randomUUID();
        const sessionToken = randomUUID();
        const now = Date.now();

        const s: ConsoleSession = {
            sessionId,
            agentId,
            sessionToken,
            createdAt: now,
            lastActivityAt: now,
            state: "created",
        };

        RemoteConsoleService.SESSIONS.set(sessionId, s);

        this.logger.log(`session created session=${sessionId} agent=${agentId}`);
        return { sessionId, sessionToken };
    }

    // ---------------- WebSocket hello/auth ----------------

    /**
     * Agent hello:
     * - validates agent token
     * - stores AGENTS registry
     * - attaches to any waiting sessions (if any)
     */
    async handleAgentHello(ws: WebSocket, agentUuid: string, agentToken: string) {
        const agentUuidTrim = String(agentUuid || "").trim();
        const agentTokenTrim = String(agentToken || "").trim();
        if (!agentUuidTrim || !agentTokenTrim) {
            wsSend(ws, { type: "hello.error", message: "Missing agentUuid/agentToken" });
            try {
                ws.close();
            } catch { }
            return;
        }

        // Resolve canonical id
        const found = await this.pg.query<{ id: string }>(
            `
      SELECT id::text AS id
      FROM public.agents
      WHERE id::text = $1 OR agent_uuid::text = $1
      LIMIT 1
      `,
            [agentUuidTrim]
        );

        const agentId = found.rows?.[0]?.id;
        if (!agentId) {
            wsSend(ws, { type: "hello.error", message: "Unknown agent" });
            try {
                ws.close();
            } catch { }
            return;
        }

        // Validate token
        const ok = await this.pg.query<{ ok: number }>(
            `
      SELECT 1 AS ok
      FROM public.agents
      WHERE (id::text = $1 OR agent_uuid::text = $1)
        AND agent_token = $2
      LIMIT 1
      `,
            [agentUuidTrim, agentTokenTrim]
        );

        if (!ok.rows?.length) {
            wsSend(ws, { type: "hello.error", message: "Unauthorized" });
            try {
                ws.close();
            } catch { }
            return;
        }

        // Register agent WS (kick previous)
        const existing = RemoteConsoleService.AGENTS.get(agentId);
        if (existing && existing !== ws) {
            try {
                existing.close();
            } catch { }
        }
        RemoteConsoleService.AGENTS.set(agentId, ws);

        // Mark on socket
        (ws as any).__rcAuthed = true;
        (ws as any).__rcKind = "agent";
        (ws as any).__rcAgentId = agentId;

        wsSend(ws, { type: "hello.ok", agentId });

        this.logger.log(`agent authed for remote-console agent=${agentId}`);

        // If there are sessions for this agent waiting, attach
        for (const s of RemoteConsoleService.SESSIONS.values()) {
            if (s.state === "closed" || s.state === "error") continue;
            if (s.agentId !== agentId) continue;

            // Attach agentWs if missing
            if (!wsReady(s.agentWs)) {
                s.agentWs = ws;
                s.lastActivityAt = Date.now();
                s.state = wsReady(s.techWs) ? "active" : "waiting";
                this.maybeAnnounceReady(s);
            }
        }
    }

    /**
     * Tech hello:
     * - validates sessionId + token
     * - attaches techWs
     * - if agent connected, session becomes active and we announce ready
     */
    handleTechHello(ws: WebSocket, sessionId: string, sessionToken: string) {
        const sid = String(sessionId || "").trim();
        const tok = String(sessionToken || "").trim();
        if (!sid || !tok) {
            wsSend(ws, { type: "hello.error", message: "Missing sessionId/sessionToken" });
            try {
                ws.close();
            } catch { }
            return;
        }

        const s = RemoteConsoleService.SESSIONS.get(sid);
        if (!s || s.state === "closed" || s.state === "error") {
            wsSend(ws, { type: "hello.error", message: "Unknown session" });
            try {
                ws.close();
            } catch { }
            return;
        }

        // Token + expiry check
        const now = Date.now();
        const age = now - s.createdAt;
        if (s.sessionToken !== tok) {
            wsSend(ws, { type: "hello.error", message: "Unauthorized" });
            try {
                ws.close();
            } catch { }
            return;
        }
        if (age > this.tokenTtlMs) {
            wsSend(ws, { type: "hello.error", message: "Session token expired" });
            this.closeSession(sid, "token_expired");
            try {
                ws.close();
            } catch { }
            return;
        }

        // Kick prior tech connection
        if (wsReady(s.techWs) && s.techWs !== ws) {
            try {
                s.techWs!.close();
            } catch { }
        }

        // Attach tech
        s.techWs = ws;
        s.lastActivityAt = now;

        // Attach agentWs if agent is already registered
        const agentWs = RemoteConsoleService.AGENTS.get(s.agentId);
        if (wsReady(agentWs)) s.agentWs = agentWs;

        s.state = wsReady(s.agentWs) ? "active" : "waiting";

        // Mark on socket
        (ws as any).__rcAuthed = true;
        (ws as any).__rcKind = "tech";
        (ws as any).__rcSessionId = sid;

        wsSend(ws, { type: "hello.ok", sessionId: sid });

        this.logger.log(`tech authed for remote-console session=${sid} agent=${s.agentId}`);
        this.maybeAnnounceReady(s);
    }

    // ---------------- Message relay (signaling) ----------------

    /**
     * Any "signal" messages are relayed to the opposite peer.
     * Server does not parse SDP/ICE; it just brokers.
     */
    relaySignal(fromKind: ConsolePeerKind, sessionId: string, data: any) {
        const sid = String(sessionId || "").trim();
        if (!sid) return;

        const s = RemoteConsoleService.SESSIONS.get(sid);
        if (!s || s.state === "closed" || s.state === "error") return;

        s.lastActivityAt = Date.now();

        if (fromKind === "tech") {
            wsSend(s.agentWs, { type: "signal", sessionId: sid, data });
        } else {
            wsSend(s.techWs, { type: "signal", sessionId: sid, data });
        }
    }

    // ---------------- Keepalive / activity bump ----------------

    /**
     * IMPORTANT:
     * Once WebRTC connects, signaling can go quiet for long periods.
     * We must treat ping/pong as activity, or idle cleanup will kill active sessions.
     */
    private bumpActivityForSocket(ws: WebSocket) {
        const authed = Boolean((ws as any).__rcAuthed);
        if (!authed) return;

        const kind = String((ws as any).__rcKind || "") as ConsolePeerKind;
        const now = Date.now();

        if (kind === "tech") {
            const sid = String((ws as any).__rcSessionId || "").trim();
            if (!sid) return;
            const s = RemoteConsoleService.SESSIONS.get(sid);
            if (!s || s.state === "closed" || s.state === "error") return;
            s.lastActivityAt = now;
            return;
        }

        if (kind === "agent") {
            const agentId = String((ws as any).__rcAgentId || "").trim();
            if (!agentId) return;
            for (const s of RemoteConsoleService.SESSIONS.values()) {
                if (s.agentId !== agentId) continue;
                if (s.state === "closed" || s.state === "error") continue;
                s.lastActivityAt = now;
            }
        }
    }

    // ---------------- Disconnect handling ----------------

    handleSocketClosed(ws: WebSocket) {
        const authed = Boolean((ws as any).__rcAuthed);
        if (!authed) return;

        const kind = String((ws as any).__rcKind || "") as ConsolePeerKind;

        if (kind === "agent") {
            const agentId = String((ws as any).__rcAgentId || "");
            if (agentId) {
                const cur = RemoteConsoleService.AGENTS.get(agentId);
                if (cur === ws) RemoteConsoleService.AGENTS.delete(agentId);

                // Any active sessions for this agent must close
                for (const s of RemoteConsoleService.SESSIONS.values()) {
                    if (s.agentId !== agentId) continue;
                    if (s.state === "closed" || s.state === "error") continue;
                    if (s.agentWs === ws) {
                        s.agentWs = undefined;
                        this.closeSession(s.sessionId, "agent_disconnected");
                    }
                }
            }
            return;
        }

        if (kind === "tech") {
            const sid = String((ws as any).__rcSessionId || "");
            if (!sid) return;
            const s = RemoteConsoleService.SESSIONS.get(sid);
            if (!s) return;

            if (s.techWs === ws) s.techWs = undefined;

            // If tech leaves, we close the session (simple policy).
            this.closeSession(sid, "tech_disconnected");
        }
    }

    // ---------------- Close / cleanup ----------------

    closeSession(sessionId: string, reason: string) {
        const sid = String(sessionId || "").trim();
        if (!sid) return;

        const s = RemoteConsoleService.SESSIONS.get(sid);
        if (!s || s.state === "closed") return;

        s.state = "closed";
        s.lastActivityAt = Date.now();

        wsSend(s.agentWs, { type: "session.closed", sessionId: sid, reason });
        wsSend(s.techWs, { type: "session.closed", sessionId: sid, reason });

        /**
         * IMPORTANT:
         * Do NOT close agent WS here.
         * The agent should stay connected for future sessions.
         */
        try {
            if (wsReady(s.techWs)) s.techWs!.close();
        } catch { }

        RemoteConsoleService.SESSIONS.delete(sid);

        this.logger.log(`session closed session=${sid} reason=${reason}`);
    }

    private maybeAnnounceReady(s: ConsoleSession) {
        const sid = s.sessionId;
        const ready = wsReady(s.agentWs) && wsReady(s.techWs);

        if (!ready) return;

        // session is active
        s.state = "active";
        s.lastActivityAt = Date.now();

        wsSend(s.agentWs, { type: "session.ready", sessionId: sid });
        wsSend(s.techWs, { type: "session.ready", sessionId: sid });

        this.logger.log(`session ready session=${sid} agent=${s.agentId}`);
    }

    private cleanup() {
        const now = Date.now();

        for (const s of RemoteConsoleService.SESSIONS.values()) {
            if (s.state === "closed" || s.state === "error") {
                RemoteConsoleService.SESSIONS.delete(s.sessionId);
                continue;
            }

            // If session was created but never used, expire it
            if (now - s.createdAt > this.tokenTtlMs && !wsReady(s.techWs)) {
                this.closeSession(s.sessionId, "token_expired");
                continue;
            }

            // If active/idle too long, close
            if (now - s.lastActivityAt > this.idleTtlMs) {
                this.closeSession(s.sessionId, "idle_timeout");
                continue;
            }
        }
    }

    // ---------------- WS entry helpers ----------------

    /**
     * Used by the gateway:
     * - parses text messages
     * - routes hello/signal/ping
     */
    async handleWsMessage(ws: WebSocket, data: any, isBinary: boolean) {
        if (isBinary) {
            // We do not accept binary on signaling WS (WebRTC media/data is P2P)
            return;
        }

        const text = rawToUtf8(data);
        if (!text) return;

        const msg = safeJsonParse(text);
        if (!msg?.type) return;

        const type = String(msg.type);

        if (type === "hello") {
            const kind = String(msg.kind || "");
            if (kind === "agent") {
                await this.handleAgentHello(ws, msg.agentUuid, msg.agentToken);
                return;
            }
            if (kind === "tech") {
                this.handleTechHello(ws, msg.sessionId, msg.sessionToken);
                return;
            }
            wsSend(ws, { type: "hello.error", message: "Invalid hello kind" });
            try {
                ws.close();
            } catch { }
            return;
        }

        // Everything below requires authed socket
        const authed = Boolean((ws as any).__rcAuthed);
        const kind = String((ws as any).__rcKind || "") as ConsolePeerKind;
        if (!authed || (kind !== "agent" && kind !== "tech")) return;

        if (type === "ping") {
            // Treat ping as activity so idle cleanup doesn't kill active WebRTC sessions.
            this.bumpActivityForSocket(ws);
            wsSend(ws, { type: "pong", ts: Number(msg.ts || Date.now()) });
            return;
        }

        if (type === "pong") {
            // If clients ever send pong, treat it as activity too.
            this.bumpActivityForSocket(ws);
            return;
        }

        if (type === "signal") {
            const sessionId = String(msg.sessionId || "");
            this.relaySignal(kind, sessionId, msg.data);
            return;
        }

        // ignore unknown messages
    }
}
