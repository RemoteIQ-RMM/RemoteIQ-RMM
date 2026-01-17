//backend\src\users\me.controller.ts

import {
    Controller,
    Get,
    Patch,
    Body,
    UseInterceptors,
    UploadedFile,
    Post,
    Delete,
    Req,
    BadRequestException,
    UnauthorizedException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import type { Request } from "express";
import { MeService } from "./me.service";
import { RequirePerm } from "../auth/require-perm.decorator";

/* ----------------------------- MIME → EXT map ----------------------------- */
const EXT_BY_MIME: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const UPLOAD_RATE_MS = 5_000;
const lastUploadByUser = new Map<string, number>();

function filenameCb(
    _req: any,
    file: Express.Multer.File,
    callback: (error: Error | null, filename: string) => void
) {
    const ext = EXT_BY_MIME[file.mimetype] ?? ".bin";
    const base =
        (file.originalname || "upload")
            .replace(/[^\w.\-]+/g, "_")
            .replace(/\.[A-Za-z0-9]+$/, "")
            .slice(0, 80) || "upload";
    const safe = `${Date.now()}_${base}${ext}`;
    callback(null, safe);
}

function imageFilter(
    _req: any,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void
) {
    const ok = !!EXT_BY_MIME[file.mimetype];
    if (!ok) return callback(new BadRequestException("Unsupported file type"), false);
    return callback(null, true);
}

function buildStaticUploadUrl(req: Request, filename: string): string {
    const raw = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    let origin: string;
    if (raw) {
        const staticBase = raw.endsWith("/static") ? raw : `${raw}/static`;
        origin = staticBase;
    } else {
        const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
        const host = req.get("host") || "localhost:3001";
        origin = `${proto}://${host}/static`;
    }
    return `${origin}/uploads/${encodeURIComponent(filename)}`;
}

@Controller("/api/users")
export class MeController {
    constructor(private readonly me: MeService) { }

    @Get("me")
    @RequirePerm("me.read")
    async getMe(@Req() req: any) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");
        return this.me.getMe(userId);
    }

    @Patch("me")
    @RequirePerm("me.write")
    async patchMe(@Req() req: any, @Body() body: any) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");
        return this.me.updateMe(userId, body);
    }

    @Post("me/avatar")
    @RequirePerm("me.write")
    @UseInterceptors(
        FileInterceptor("file", {
            storage: diskStorage({
                destination: "public/uploads",
                filename: filenameCb,
            }),
            limits: {
                fileSize: Math.max(1, (Number(process.env.AVATAR_MAX_MB) || 5) * 1024 * 1024),
            },
            fileFilter: imageFilter,
        })
    )
    async uploadAvatar(@Req() req: Request & { user?: any }, @UploadedFile() file: Express.Multer.File) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");
        if (!file) throw new BadRequestException("No file uploaded");

        const now = Date.now();
        const last = lastUploadByUser.get(userId) || 0;
        if (now - last < UPLOAD_RATE_MS) {
            throw new BadRequestException("You're uploading too fast. Please wait a moment and try again.");
        }
        lastUploadByUser.set(userId, now);

        const url = buildStaticUploadUrl(req, file.filename);
        await this.me.replaceAvatarUrl(userId, url);

        return { url };
    }

    @Delete("me/avatar")
    @RequirePerm("me.write")
    async deleteAvatar(@Req() req: any) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");

        await this.me.replaceAvatarUrl(userId, null);
        return { ok: true };
    }
}
