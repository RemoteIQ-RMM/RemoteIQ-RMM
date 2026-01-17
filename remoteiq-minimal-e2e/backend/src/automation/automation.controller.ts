// src/automation/automation.controller.ts
import { Body, Controller, NotFoundException, Param, Post, Get } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AgentGateway } from "../ws/agent.gateway";
import { RequirePerm } from "../auth/require-perm.decorator";

/**
 * NOTE:
 * This controller originally collided with RunsController routes under /api/automation.
 * It is now moved under /api/automation/legacy to avoid route conflicts.
 */

type RunScriptDto = {
    deviceId: string;
    script: string;
    shell?: "powershell" | "bash" | "cmd";
    timeoutSec?: number;
};

type Job = {
    jobId: string;
    deviceId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    log: string;
    exitCode?: number | null;
};

const JOBS = new Map<string, Job>();

@Controller("/api/automation/legacy")
export class AutomationLegacyController {
    constructor(private readonly ws: AgentGateway) { }

    @Post("runs")
    @RequirePerm("automation.run")
    async start(@Body() body: RunScriptDto) {
        if (!body?.deviceId || !body?.script) {
            throw new NotFoundException("Missing deviceId or script");
        }

        const jobId = randomUUID();
        const job: Job = { jobId, deviceId: body.deviceId, status: "queued", log: "" };
        JOBS.set(jobId, job);

        // Immediately broadcast queued
        this.ws.broadcast({ type: "job.run.updated", jobId, status: "queued", progress: 0 });

        // Simulate work
        setTimeout(() => {
            job.status = "running";
            this.ws.broadcast({
                type: "job.run.updated",
                jobId,
                status: "running",
                progress: 5,
                chunk: `$ ${body.shell ?? "ps"} -c ...\n`,
            });
        }, 300);

        setTimeout(() => {
            job.log += "Doing work...\n";
            this.ws.broadcast({ type: "job.run.updated", jobId, status: "running", progress: 40, chunk: "Doing work...\n" });
        }, 1000);

        setTimeout(() => {
            job.log += "Halfway there...\n";
            this.ws.broadcast({ type: "job.run.updated", jobId, status: "running", progress: 65, chunk: "Halfway there...\n" });
        }, 1800);

        setTimeout(() => {
            job.log += "Finishing...\n";
            this.ws.broadcast({ type: "job.run.updated", jobId, status: "running", progress: 90, chunk: "Finishing...\n" });
        }, 2500);

        setTimeout(() => {
            job.status = "succeeded";
            job.exitCode = 0;
            job.log += "Done.\n";
            this.ws.broadcast({ type: "job.run.updated", jobId, status: "succeeded", progress: 100, chunk: "Done.\n", exitCode: 0 });
        }, 3200);

        return { jobId };
    }

    @Get("runs/:jobId/log")
    @RequirePerm("automation.read")
    async log(@Param("jobId") jobId: string) {
        const job = JOBS.get(jobId);
        if (!job) throw new NotFoundException("Job not found");
        return { jobId, log: job.log };
    }
}
