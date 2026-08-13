// backend/src/remote-console/remote-console.types.ts

import type WebSocket from "ws";

export type ConsolePeerKind = "agent" | "tech";

export type ConsoleSessionState = "created" | "waiting" | "active" | "closed" | "error";

export type ConsoleSession = {
    sessionId: string;

    // Canonical agent id from DB (agents.id)
    agentId: string;

    // One-time token given to the tech UI for WS hello
    sessionToken: string;

    createdAt: number;
    lastActivityAt: number;

    state: ConsoleSessionState;

    // WS endpoints
    agentWs?: WebSocket;
    techWs?: WebSocket;

    // Optional diagnostics
    error?: string;
};

export type WsHelloAgent = {
    type: "hello";
    kind: "agent";
    agentUuid: string; // can be agents.id or agents.agent_uuid
    agentToken: string;
};

export type WsHelloTech = {
    type: "hello";
    kind: "tech";
    sessionId: string;
    sessionToken: string;
};

export type WsSignal = {
    type: "signal";
    sessionId: string;
    data: any; // SDP offer/answer, ICE candidates, etc.
};

export type WsPing = { type: "ping"; ts: number };
export type WsPong = { type: "pong"; ts: number };

export type WsServerToClient =
    | { type: "hello.ok"; sessionId?: string; agentId?: string }
    | { type: "hello.error"; message: string }
    | { type: "session.ready"; sessionId: string }
    | { type: "session.closed"; sessionId: string; reason: string }
    | { type: "signal"; sessionId: string; data: any }
    | WsPing
    | WsPong;
