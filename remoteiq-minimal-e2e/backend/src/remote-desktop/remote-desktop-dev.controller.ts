// backend/src/remote-desktop/remote-desktop-dev.controller.ts

import {
    BadRequestException,
    Body,
    Controller,
    Get,
    NotFoundException,
    Post,
} from "@nestjs/common";
import { RemoteDesktopTunnelService } from "./remote-desktop-tunnel.service";

function ensureDevOnly() {
    if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
        // Hide the existence of dev endpoints in prod
        throw new NotFoundException();
    }
}

function asNonEmptyString(v: any): string | null {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.length ? s : null;
}

function asPort(v: any): number | null {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(String(v));
    if (!Number.isFinite(n)) return null;
    const p = Math.trunc(n);
    if (p < 1 || p > 65535) return null;
    return p;
}

type OpenTunnelBody = {
    agentUuid: string; // agents.id or agents.agent_uuid
    host?: string;
    port?: number;
};

type CloseTunnelBody = {
    sessionId: string;
    reason?: string;
};

@Controller("/api/remote-desktop/dev")
export class RemoteDesktopDevController {
    constructor(private readonly tunnels: RemoteDesktopTunnelService) { }

    @Get("/sessions")
    getSessions() {
        ensureDevOnly();
        return {
            ok: true,
            agents: this.tunnels.listConnectedAgents(),
            sessions: this.tunnels.listSessions(),
        };
    }

    @Post("/open-tunnel")
    async openTunnel(@Body() body: OpenTunnelBody) {
        ensureDevOnly();

        const agentUuid = asNonEmptyString(body?.agentUuid);
        if (!agentUuid) throw new BadRequestException("agentUuid is required");

        const host = asNonEmptyString(body?.host) ?? "127.0.0.1";
        const port = asPort(body?.port) ?? 3389;

        const res = await this.tunnels.openTunnel(agentUuid, { host, port });

        return {
            ok: true,
            sessionId: res.sessionId,
            localPort: res.localPort,
            target: { host, port },
        };
    }

    @Post("/close-tunnel")
    async closeTunnel(@Body() body: CloseTunnelBody) {
        ensureDevOnly();

        const sessionId = asNonEmptyString(body?.sessionId);
        if (!sessionId) throw new BadRequestException("sessionId is required");

        const reason = asNonEmptyString(body?.reason) ?? "dev_close";
        await this.tunnels.closeTunnel(sessionId, reason);

        return { ok: true };
    }
}
