import { Controller, Get, Param, Query } from "@nestjs/common";
import { ChecksRuntimeService } from "./checks.runtime.service";

@Controller("api/devices")
export class ChecksReadController {
    constructor(private readonly checksRuntime: ChecksRuntimeService) { }

    // Frontend UI fetch for a device's checks
    // GET /api/devices/:deviceId/checks?limit=100
    @Get(":deviceId/checks")
    async listForDevice(
        @Param("deviceId") deviceId: string,
        @Query("limit") limit?: string,
    ) {
        const l = limit ? parseInt(limit, 10) : 100;
        return this.checksRuntime.listByDevice(deviceId, Number.isFinite(l) ? l : 100);
    }
}
