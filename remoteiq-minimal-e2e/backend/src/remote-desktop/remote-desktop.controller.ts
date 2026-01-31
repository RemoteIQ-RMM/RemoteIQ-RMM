// backend/src/remote-desktop/remote-desktop.controller.ts

import {
    BadRequestException,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Post,
    Body,
    ServiceUnavailableException,
    Res,
} from "@nestjs/common";
import type { Response } from "express";

import { PgPoolService } from "../storage/pg-pool.service";
import { RemoteDesktopTunnelService } from "./remote-desktop-tunnel.service";

function asNonEmptyString(v: any): string | null {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.length ? s : null;
}

function ensureOneOf(deviceId?: string | null, agentUuid?: string | null) {
    const hasDeviceId = !!deviceId;
    const hasAgentUuid = !!agentUuid;

    if (hasDeviceId && hasAgentUuid) {
        throw new BadRequestException("Please use only one: deviceId OR agentUuid.");
    }
    if (!hasDeviceId && !hasAgentUuid) {
        throw new BadRequestException("You must provide either deviceId or agentUuid.");
    }
}

type CreateSessionBody = {
    deviceId?: string;
    agentUuid?: string;
    // optional overrides if you later want them (keep safe defaults)
    host?: string;
    port?: number;
};

@Controller("/api/remote-desktop")
export class RemoteDesktopController {
    constructor(
        private readonly pg: PgPoolService,
        private readonly tunnels: RemoteDesktopTunnelService
    ) { }

    /**
     * List connected agents + active sessions (for UI polling).
     */
    @Get("/sessions")
    getSessions() {
        return {
            ok: true,
            agents: this.tunnels.listConnectedAgents(),
            sessions: this.tunnels.listSessions(),
        };
    }

    /**
     * Create an RDP tunnel session.
     * Body must include EXACTLY ONE of: { deviceId } OR { agentUuid }.
     */
    @Post("/sessions")
    async createSession(@Body() body: CreateSessionBody) {
        const deviceId = asNonEmptyString(body?.deviceId);
        const agentUuid = asNonEmptyString(body?.agentUuid);

        ensureOneOf(deviceId, agentUuid);

        // Defaults: Windows RDP on localhost of endpoint
        const host = asNonEmptyString(body?.host) ?? "127.0.0.1";
        const port =
            typeof body?.port === "number" && Number.isFinite(body.port) ? body.port : 3389;

        let resolvedAgentUuid = agentUuid;

        // If they pass deviceId, resolve to agent id/uuid
        if (!resolvedAgentUuid && deviceId) {
            const found = await this.pg.query<{ agent_uuid: string | null; id: string }>(
                `
        SELECT
          COALESCE(NULLIF(agent_uuid::text, ''), id::text) AS agent_uuid,
          id::text AS id
        FROM public.agents
        WHERE device_id::text = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
        `,
                [deviceId]
            );

            const row = found.rows?.[0];
            resolvedAgentUuid = (row?.agent_uuid ?? row?.id ?? "").trim() || null;

            if (!resolvedAgentUuid) {
                throw new BadRequestException(
                    "No agent is registered for this deviceId yet."
                );
            }
        }

        try {
            const { sessionId, localPort } = await this.tunnels.openTunnel(
                String(resolvedAgentUuid),
                { host, port }
            );

            // IMPORTANT: today, localPort is bound on the backend machine (127.0.0.1).
            // The UI will download an .rdp that points to 127.0.0.1:localPort.
            return {
                ok: true,
                sessionId,
                host: "127.0.0.1",
                port: localPort,
                target: { host, port },
            };
        } catch (e: any) {
            const msg = String(e?.message || e || "Unknown error");

            if (/agent not connected/i.test(msg)) {
                throw new ServiceUnavailableException(
                    "Desktop tunnel agent is not connected. Ensure the Windows agent is running and connected to /ws/desktop-tunnel."
                );
            }

            throw new BadRequestException(msg);
        }
    }

    /**
     * Close a session.
     */
    @Delete("/sessions/:sessionId")
    async closeSession(@Param("sessionId") sessionId: string) {
        const sid = asNonEmptyString(sessionId);
        if (!sid) throw new BadRequestException("sessionId is required");

        await this.tunnels.closeTunnel(sid, "ui_close");
        return { ok: true };
    }

    /**
     * Download an .rdp file for a session.
     * Browser opens this in a new tab/window; Windows should launch MSTSC.
     */
    @Get("/sessions/:sessionId/rdp")
    async downloadRdp(@Param("sessionId") sessionId: string, @Res() res: Response) {
        const sid = asNonEmptyString(sessionId);
        if (!sid) throw new BadRequestException("sessionId is required");

        const sess = this.tunnels
            .listSessions()
            .find((s) => String(s.sessionId) === String(sid));

        if (!sess) throw new NotFoundException("Session not found");
        if (!sess.localPort || typeof sess.localPort !== "number") {
            throw new BadRequestException("Session has no localPort");
        }
        if (String(sess.state) !== "ready") {
            throw new BadRequestException(`Session is not ready (state=${sess.state})`);
        }

        // Today: backend listens on 127.0.0.1:<localPort> on the backend machine.
        // In local dev where you’re running everything on one machine, this works.
        // In production, you’ll likely replace this with a browser-based solution.
        const fullAddress = `127.0.0.1:${sess.localPort}`;

        const rdp = [
            `full address:s:${fullAddress}`,
            `prompt for credentials:i:1`,
            `administrative session:i:0`,
            `screen mode id:i:2`,
            `use multimon:i:0`,
            `compression:i:1`,
            `redirectclipboard:i:1`,
            `redirectprinters:i:0`,
            `redirectcomports:i:0`,
            `redirectsmartcards:i:0`,
            `redirectposdevices:i:0`,
            `autoreconnection enabled:i:1`,
            `authentication level:i:2`,
            `negotiate security layer:i:1`,
            `enablecredsspsupport:i:1`,
            ``,
        ].join("\r\n");

        res.setHeader("Content-Type", "application/x-rdp; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="remoteiq-${sid}.rdp"`
        );
        res.status(200).send(rdp);
    }
}
