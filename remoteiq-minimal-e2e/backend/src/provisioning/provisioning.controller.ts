// backend/src/provisioning/provisioning.controller.ts
import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    Res,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import type { Response } from "express";
import * as fs from "node:fs";
import { RequirePerm } from "../auth/require-perm.decorator";
import { Public } from "../auth/public.decorator";
import { ProvisioningService } from "./provisioning.service";
import { CreateEndpointDto, type CreateEndpointResult } from "./dto/create-endpoint.dto";
import { CreateEnrollmentKeyDto, type CreateEnrollmentKeyResult } from "./dto/create-enrollment-key.dto";
import { CreateInstallerBundleDto, type CreateInstallerBundleResult } from "./dto/create-installer-bundle.dto";

function safeAttachmentFilename(name: string): string {
    const cleaned = String(name ?? "download.txt").replace(/[\r\n"]/g, "").trim();
    return cleaned.length ? cleaned : "download.txt";
}

@Controller("/api/provisioning")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ProvisioningController {
    constructor(private readonly provisioning: ProvisioningService) { }

    @Post("endpoints")
    @RequirePerm("customers.write")
    async createEndpoint(@Body() body: CreateEndpointDto): Promise<CreateEndpointResult> {
        return await this.provisioning.createEndpoint(body);
    }

    @Post("enrollment-keys")
    @RequirePerm("customers.write")
    async createEnrollmentKey(
        @Req() req: any,
        @Body() body: CreateEnrollmentKeyDto
    ): Promise<CreateEnrollmentKeyResult> {
        const userId = req?.user?.id ? String(req.user.id) : null;
        return await this.provisioning.createEnrollmentKey(body, userId);
    }

    @Post("installer-bundles")
    @RequirePerm("customers.write")
    async createInstallerBundle(@Body() body: CreateInstallerBundleDto): Promise<CreateInstallerBundleResult> {
        return await this.provisioning.createInstallerBundle(body);
    }

    @Public()
    @Get("installer-bundles/:id/download")
    async downloadInstallerBundle(
        @Param("id") id: string,
        @Query("token") token: string | undefined,
        @Res({ passthrough: false }) res: Response
    ): Promise<void> {
        const out = await this.provisioning.getInstallerBundleDownload(id, token);

        const filename = safeAttachmentFilename(out.filename);
        const body = out.content ?? "";

        res.status(200);
        res.setHeader("Content-Type", out.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.send(body);
    }

    /**
     * Downloads the agent package (zip) authorized by the same short-lived bundle token.
     * Used by the bootstrap PS1.
     */
    @Public()
    @Get("installer-bundles/:id/agent-package")
    async downloadAgentPackage(
        @Param("id") id: string,
        @Query("token") token: string | undefined,
        @Res({ passthrough: false }) res: Response
    ): Promise<void> {
        const out = await this.provisioning.getInstallerBundleAgentPackageDownload(id, token);

        const filename = safeAttachmentFilename(out.filename);

        res.status(200);
        res.setHeader("Content-Type", out.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");

        const stream = fs.createReadStream(out.absPath);
        stream.on("error", () => {
            try {
                if (!res.headersSent) res.status(500);
                res.end();
            } catch { }
        });

        stream.pipe(res);
    }
}
