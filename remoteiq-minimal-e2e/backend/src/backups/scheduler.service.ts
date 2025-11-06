import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import * as cronParser from "cron-parser";
import { BackupsService } from "./backups.service";
import { WorkerService } from "./worker.service";

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
    private cronTimer?: NodeJS.Timeout;
    private workerTimer?: NodeJS.Timeout;
    private log = new Logger("BackupsScheduler");

    constructor(
        private readonly svc: BackupsService,
        private readonly worker: WorkerService
    ) { }

    onModuleInit() {
        // Check cron schedule every 30s
        this.cronTimer = setInterval(
            () => this.tickCron().catch((e) => this.log.error(e?.message || e)),
            30_000
        );
        // Worker pump every 5s to process any running jobs
        this.workerTimer = setInterval(
            () => this.worker.runOneIfAny().catch(() => { }),
            5_000
        );
    }

    onModuleDestroy() {
        if (this.cronTimer) clearInterval(this.cronTimer);
        if (this.workerTimer) clearInterval(this.workerTimer);
    }

    private async tickCron() {
        const cfg = await this.svc.getConfig();
        if (!cfg.enabled) return;

        const now = new Date();
        let due = false;

        if (cfg.schedule === "hourly") {
            due = now.getMinutes() === 0;
        } else if (cfg.schedule === "daily") {
            due = now.getHours() === 3 && now.getMinutes() === 0;
        } else if (cfg.schedule === "weekly") {
            due = now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() === 0;
        } else if (cfg.schedule === "cron" && cfg.cronExpr) {
            const parse = (cronParser as any).parseExpression as
                | ((expr: string, opts?: any) => { prev(): { toDate(): Date } })
                | undefined;
            if (typeof parse !== "function") {
                this.log.warn("cron-parser parseExpression not available");
            } else {
                const it = parse(cfg.cronExpr, {
                    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                const prev = it.prev().toDate();
                // fire if previous occurrence is within last minute
                due = +now - +prev < 60_000;
            }
        }

        if (!due) return;

        this.log.log("Cron window due → starting backup job");
        await this.svc.startBackupNow();
        // Immediately try to process it
        this.worker.runOneIfAny().catch(() => { });
    }
}
