// backend/src/remote-console/remote-console.controller.ts

import { Body, Controller, Get, Post } from "@nestjs/common";
import { RemoteConsoleService } from "./remote-console.service";

@Controller("/api/remote-console")
export class RemoteConsoleController {
    constructor(private readonly rc: RemoteConsoleService) { }

    /**
     * TECH UI calls this to start a remote console session.
     * Auth is enforced by your existing global guards.
     */
    @Post("/sessions")
    async createSession(@Body() body: { agentId: string }) {
        const agentId = String(body?.agentId || "").trim();
        const { sessionId, sessionToken } = await this.rc.createSession(agentId);

        return {
            sessionId,
            sessionToken,
            wsPath: "/ws/remote-console",
        };
    }

    /**
     * Dev visibility (optional).
     * If you don't want this exposed, remove or guard it.
     */
    @Get("/debug")
    debug() {
        return {
            agents: this.rc.listConnectedAgents(),
            sessions: this.rc.listSessions(),
        };
    }
}
