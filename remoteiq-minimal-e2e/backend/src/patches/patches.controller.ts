import { Body, Controller, Get, HttpCode, Query, Req, Post, UsePipes, ValidationPipe } from "@nestjs/common";
import { RequirePerm } from "../auth/require-perm.decorator";
import { PatchScanDto } from "./dto/patch-scan.dto";
import { PatchInstallDto } from "./dto/patch-install.dto";
import { PatchesService } from "./patches.service";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
@Controller("/api/patches")
export class PatchesController {
    constructor(private readonly patches: PatchesService) { }

    // Auth-only (no RequirePerm) so any logged-in user can view patch status.
    @Get("latest")
    async latest(@Query("deviceId") deviceId?: string) {
        if (!deviceId) {
            return { ok: true, lastScanAt: null, patches: [] };
        }
        return this.patches.getLatest(String(deviceId));
    }

    // Auth-only: patch install history for a device.
    @Get("history")
    async history(@Query("deviceId") deviceId?: string, @Query("limit") limit?: string) {
        if (!deviceId) {
            return { ok: true, items: [] };
        }
        const limRaw = parseInt(String(limit ?? "200"), 10);
        const lim = Number.isFinite(limRaw) ? Math.min(Math.max(limRaw, 1), 500) : 200;
        return this.patches.getHistory(String(deviceId), lim);
    }

    @Post("scan")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async scan(@Req() req: any, @Body() body: PatchScanDto) {
        const createdBy = req?.user?.id ? String(req.user.id) : null;
        const includeOptional = !!body.includeOptional;

        const res = await this.patches.enqueueScan(String(body.deviceId), includeOptional, createdBy);
        return { ok: true, ...res };
    }

    @Post("install")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async install(@Req() req: any, @Body() body: PatchInstallDto) {
        const createdBy = req?.user?.id ? String(req.user.id) : null;
        const includeOptional = !!body.includeOptional;

        const ids = (body.ids ?? []).map((x) => String(x).trim()).filter(Boolean);

        const res = await this.patches.enqueueInstall(String(body.deviceId), includeOptional, ids, createdBy);
        return { ok: true, ...res };
    }
}
