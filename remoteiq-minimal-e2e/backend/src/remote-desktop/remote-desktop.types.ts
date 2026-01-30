// backend/src/remote-desktop/remote-desktop.types.ts

import type * as net from "node:net";

export type DesktopTunnelState = "opening" | "ready" | "closed" | "error";

export type DesktopTunnelSession = {
    sessionId: string;
    agentUuid: string;

    createdAt: number;
    lastActivityAt: number;

    state: DesktopTunnelState;
    error?: { code: string; message: string };

    // Local TCP bridge (guacd will connect here in Phase 2)
    tcpServer?: net.Server;
    localPort?: number;

    // Single active TCP connection per session (deny extras)
    tcpSocket?: net.Socket;
};

export type AgentControlMessage =
    | { type: "rdp.open"; sessionId: string; host: string; port: number }
    | { type: "rdp.close"; sessionId: string; reason?: string }
    | { type: "ping"; ts: number };

export type BackendControlMessage =
    | { type: "rdp.ready"; sessionId: string }
    | { type: "rdp.closed"; sessionId: string; reason?: string }
    | { type: "rdp.error"; sessionId: string; code: string; message: string }
    | { type: "pong"; ts: number };
