// backend/src/jobs/runs.service.ts
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { UiSocketRegistry } from "../common/ui-socket-registry.service";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type JobSnapshot = {
    jobId: string;
    deviceId: string;
    status: JobStatus;
    log: string;
    exitCode?: number | null;
    startedAt: number;
    finishedAt?: number | null;
};

export type StartRunInput = {
    deviceId: string;
    script: string;
    shell?: "powershell" | "bash" | "cmd";
    timeoutSec?: number;
};

@Injectable()
export class RunsService {
    private JOBS = new Map<string, JobSnapshot>();

    constructor(private readonly uiSockets: UiSocketRegistry) { }

    get(jobId: string) {
        return this.JOBS.get(jobId);
    }

    async startRun(input: StartRunInput): Promise<string> {
        const jobId = randomUUID();

        const snap: JobSnapshot = {
            jobId,
            deviceId: input.deviceId,
            status: "queued",
            log: "",
            startedAt: Date.now(),
        };
        this.JOBS.set(jobId, snap);

        this.broadcastToDevice(input.deviceId, {
            type: "job.run.updated",
            jobId,
            status: "queued",
            progress: 0,
            chunk: "",
            exitCode: null,
            finishedAt: null,
        });

        // --- Simulated execution: replace with real agent execution later ---
        setTimeout(() => {
            this.append(jobId, `$ ${input.shell ?? "ps"} executing...\n`, {
                status: "running",
                progress: 5,
            });
        }, 300);

        setTimeout(() => {
            this.append(jobId, "Doing work...\n", { status: "running", progress: 40 });
        }, 1000);

        setTimeout(() => {
            this.append(jobId, "Halfway there...\n", { status: "running", progress: 65 });
        }, 1800);

        setTimeout(() => {
            this.append(jobId, "Finishing...\n", { status: "running", progress: 90 });
        }, 2500);

        setTimeout(() => {
            const done = this.JOBS.get(jobId);
            if (!done) return;

            done.status = "succeeded";
            done.exitCode = 0;
            done.finishedAt = Date.now();
            done.log += "Done.\n";

            this.broadcastToDevice(done.deviceId, {
                type: "job.run.updated",
                jobId,
                status: "succeeded",
                progress: 100,
                chunk: "Done.\n",
                exitCode: 0,
                finishedAt: new Date().toISOString(),
            });
        }, 3200);
        // -------------------------------------------------------------------

        return jobId;
    }

    private append(
        jobId: string,
        chunk: string,
        payload: { status: JobStatus; progress?: number; exitCode?: number | null }
    ) {
        const snap = this.JOBS.get(jobId);
        if (!snap) return;

        snap.status = payload.status;
        snap.log += chunk;
        if (payload.exitCode !== undefined) snap.exitCode = payload.exitCode;

        this.broadcastToDevice(snap.deviceId, {
            type: "job.run.updated",
            jobId,
            status: payload.status,
            progress: typeof payload.progress === "number" ? payload.progress : undefined,
            chunk,
            exitCode: snap.exitCode ?? null,
            finishedAt:
                payload.status === "succeeded" || payload.status === "failed"
                    ? new Date().toISOString()
                    : null,
        });
    }

    private broadcastToDevice(deviceId: string, payload: any) {
        // Only UI sockets subscribed to this device will receive it
        this.uiSockets.broadcastToDevice(deviceId, payload);
    }
}
