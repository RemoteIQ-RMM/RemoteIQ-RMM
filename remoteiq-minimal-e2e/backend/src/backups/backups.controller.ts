import {
    Body,
    Controller,
    Get,
    Post,
    Put,
    Param,
    Query,
    Res,
    HttpException,
    HttpStatus,
    UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { BackupsService } from "./backups.service";
import { HistoryQueryDto, BackupConfigDto } from "./dto";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerm } from "../auth/require-perm.decorator";
import { WorkerService } from "./worker.service";

@Controller("/api/admin/backups")
@UseGuards(PermissionsGuard)
export class BackupsController {
    constructor(
        private readonly svc: BackupsService,
        private readonly worker: WorkerService
    ) { }

    /* ---------------- Config / Permissions ---------------- */

    @Get("config")
    @RequirePerm("backups.read")
    async getConfig() {
        return this.svc.getConfig();
    }

    @Put("config")
    @RequirePerm("backups.manage")
    async putConfig(@Body() body: BackupConfigDto) {
        this.svc.validateDestination((body as any).destination);
        return this.svc.saveConfig(body);
    }

    // Capability booleans for UI
    @Get("permissions")
    @RequirePerm("backups.read")
    async getPerms() {
        return this.svc.getPermissions();
    }

    /* ---------------- History ---------------- */

    @Get("history")
    @RequirePerm("backups.read")
    async history(@Query() q: HistoryQueryDto) {
        return this.svc.listHistory(q);
    }

    /* ---------------- Actions ---------------- */

    @Post("run")
    @RequirePerm("backups.run")
    async runNow() {
        const res = await this.svc.startBackupNow();
        // kick the worker (fire-and-forget)
        this.worker.runOneIfAny().catch(() => { });
        return res;
    }

    @Post("prune")
    @RequirePerm("backups.prune")
    async prune() {
        return this.svc.pruneOld();
    }

    @Post("test-destination")
    @RequirePerm("backups.manage")
    async testDest(@Body() body: any) {
        return this.svc.testDestination((body ?? {}).destination);
    }

    @Post(":id/retry")
    @RequirePerm("backups.run")
    async retry(@Param("id") id: string) {
        return this.svc.retryJob(id);
    }

    @Post(":id/cancel")
    @RequirePerm("backups.run")
    async cancel(@Param("id") id: string) {
        return this.svc.cancelJob(id);
    }

    @Post(":id/restore")
    @RequirePerm("backups.restore")
    async restore(@Param("id") id: string) {
        return this.svc.startRestore(id);
    }

    /* ---------------- Artifacts ---------------- */

    @Get(":id/log")
    @RequirePerm("backups.read")
    async log(@Param("id") id: string, @Res() res: Response) {
        const stream = await this.svc.openLogStream(id);
        if (!stream) throw new HttpException("Not found", HttpStatus.NOT_FOUND);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        stream.pipe(res);
    }

    @Get(":id/manifest")
    @RequirePerm("backups.read")
    async manifest(@Param("id") id: string) {
        const m = await this.svc.getManifest(id);
        if (!m) throw new HttpException("Not found", HttpStatus.NOT_FOUND);
        return m;
    }

    @Get(":id/download")
    @RequirePerm("backups.download")
    async download(@Param("id") id: string, @Res() res: Response) {
        const out = await this.svc.getDownload(id);
        if (!out) throw new HttpException("Not found", HttpStatus.NOT_FOUND);

        if (out.stream) {
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${out.filename.replace(/"/g, "")}"`
            );
            res.setHeader("Content-Type", "application/octet-stream");
            out.stream.pipe(res);
            return;
        }
        if (out.presignedUrl) {
            res.redirect(out.presignedUrl);
            return;
        }
        throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    }
}
