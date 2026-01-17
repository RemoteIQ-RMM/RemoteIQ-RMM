// src/common/health.controller.ts
import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";

/**
 * NOTE:
 * /healthz is already served by src/health/health.controller.ts.
 * This controller is moved to /healthz/ping to avoid duplicate route mapping.
 */
@Public()
@Controller("/healthz")
export class HealthController {
    @Get("ping")
    get() {
        return { ok: true, ts: Date.now() };
    }
}
