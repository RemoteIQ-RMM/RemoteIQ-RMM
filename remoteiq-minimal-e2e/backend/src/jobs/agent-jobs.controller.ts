import { Body, Controller, HttpCode, Param, Post, UseGuards, Req } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { AgentTokenGuard } from "../common/agent-token.util";
import { Public } from "../auth/public.decorator";

@Public() // ✅ agent endpoints use AgentTokenGuard; bypass AuthCookieGuard
@Controller("/api/agent/jobs")
export class AgentJobsController {
    constructor(private readonly jobs: JobsService) { }

    // Agent says: I started running this job
    @Post(":id/running")
    @UseGuards(AgentTokenGuard)
    @HttpCode(204)
    async running(@Req() _req: any, @Param("id") jobId: string) {
        await this.jobs.markRunning(jobId);
    }

    // Agent says: I finished this job (success/fail/timeout)
    @Post(":id/finish")
    @UseGuards(AgentTokenGuard)
    @HttpCode(204)
    async finish(
        @Req() _req: any,
        @Param("id") jobId: string,
        @Body()
        body: {
            status: "succeeded" | "failed" | "timeout";
            exitCode: number;
            stdout: string;
            stderr: string;
            durationMs: number;
        },
    ) {
        await this.jobs.finishJob(
            jobId,
            {
                exitCode: body.exitCode ?? -1,
                stdout: body.stdout ?? "",
                stderr: body.stderr ?? "",
                durationMs: Math.max(0, body.durationMs ?? 0),
            },
            body.status,
        );
    }
}
