// backend/src/jobs/jobs.public.controller.ts
import { Controller, Get, Param } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { RequirePerm } from "../auth/require-perm.decorator";

/**
 * Authenticated job read endpoint (for dashboard/UI polling).
 * - Uses normal cookie auth + PermissionsGuard.
 * - Requires automation.read so random authenticated users can't query arbitrary job ids.
 */
@Controller("/api/jobs")
export class JobsPublicController {
    constructor(private readonly jobs: JobsService) { }

    @Get(":id") // ✅ canonical (no leading slash)
    @RequirePerm("automation.read")
    async getJob(@Param("id") id: string) {
        return this.jobs.getJobWithResult(id);
    }
}
