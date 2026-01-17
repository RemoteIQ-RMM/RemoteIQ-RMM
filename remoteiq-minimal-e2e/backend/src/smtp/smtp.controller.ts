// backend/src/smtp/smtp.controller.ts

import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Post,
    Query,
    Req,
} from "@nestjs/common";
import { Request } from "express";
import { SmtpService } from "./smtp.service";
import {
    SaveEmailConfigDto,
    SendTestEmailDto,
    TestImapDto,
    TestPopDto,
    TestSmtpDto,
} from "./dto/smtp.dto";
import { DkimRepository } from "./dkim.repository";
import { EmailPurpose } from "./smtp.repository";
import { RequirePerm } from "../auth/require-perm.decorator";

/**
 * Admin Email endpoints used by the Settings UI.
 *
 * NOTE:
 * - PermissionsGuard is registered globally (deny-by-default + authZ),
 *   so we do NOT use @UseGuards(PermissionsGuard) here (avoids module DI issues).
 */
@Controller("api/admin/email")
export class SmtpController {
    constructor(private svc: SmtpService, private dkimRepo: DkimRepository) { }

    // Rate limit for /send-test:
    // Prefer SEND_TEST_LIMIT, else SMTP_RATE_TOKENS, else 10
    private readonly LIMIT =
        Number(process.env.SEND_TEST_LIMIT) ||
        Number(process.env.SMTP_RATE_TOKENS) ||
        10;
    private sendTestLimiter = new Map<string, { count: number; reset: number }>();
    private readonly WINDOW_MS = 60_000;

    private checkRate(req: Request) {
        const key =
            (req.headers["x-real-ip"] as string) ||
            (req.headers["x-forwarded-for"] as string) ||
            (req.ip as string) ||
            "global";
        const now = Date.now();
        const entry =
            this.sendTestLimiter.get(key) ?? {
                count: 0,
                reset: now + this.WINDOW_MS,
            };
        if (now > entry.reset) {
            entry.count = 0;
            entry.reset = now + this.WINDOW_MS;
        }
        entry.count += 1;
        this.sendTestLimiter.set(key, entry);
        if (entry.count > this.LIMIT) {
            throw new BadRequestException(
                "Rate limit exceeded for send-test. Try again shortly."
            );
        }
    }

    private audit(req: Request, action: string, details?: Record<string, unknown>) {
        const adminUser = (req.headers["x-admin-user"] as string) || "unknown-admin";
        const ip =
            (req.headers["x-real-ip"] as string) ||
            (req.headers["x-forwarded-for"] as string) ||
            (req.ip as string) ||
            "unknown-ip";
        console.log(
            JSON.stringify({
                at: new Date().toISOString(),
                category: "email",
                action,
                actor: adminUser,
                ip,
                details: details ?? {},
            })
        );
    }

    // ---------- Config ----------

    @Get()
    @RequirePerm("settings.read")
    async getConfig(@Req() req: Request) {
        this.audit(req, "email_config_get");
        return this.svc.getConfig();
    }

    @Post("save")
    @RequirePerm("settings.write")
    async save(@Req() req: Request, @Body() dto: SaveEmailConfigDto) {
        await this.svc.saveConfig({
            profiles: dto.profiles,
            lastUpdated: new Date().toISOString(),
        });
        this.audit(req, "email_config_save");
        return { ok: true };
    }

    // ---------- Connectivity tests ----------

    @Post("test-smtp")
    @RequirePerm("settings.write")
    async testSmtp(@Req() req: Request, @Body() dto: TestSmtpDto) {
        const res = await this.svc.testSmtp(dto.profile);
        this.audit(req, "email_test_smtp", { profile: dto.profile, ok: res.ok });
        return res;
    }

    @Post("test-imap")
    @RequirePerm("settings.write")
    async testImap(@Req() req: Request, @Body() dto: TestImapDto) {
        const res = await this.svc.testImap(dto.profile);
        this.audit(req, "email_test_imap", { profile: dto.profile, ok: res.ok });
        return res;
    }

    @Post("test-pop")
    @RequirePerm("settings.write")
    async testPop(@Req() req: Request, @Body() dto: TestPopDto) {
        const res = await this.svc.testPop(dto.profile);
        this.audit(req, "email_test_pop", { profile: dto.profile, ok: res.ok });
        return res;
    }

    // ---------- Send test message ----------

    @Post("send-test")
    @RequirePerm("settings.write")
    async sendTest(@Req() req: Request, @Body() dto: SendTestEmailDto) {
        this.checkRate(req);
        const res = await this.svc.sendTest(dto.profile, dto.to, dto.subject, dto.body);
        this.audit(req, "email_send_test", {
            profile: dto.profile,
            to: dto.to,
            ok: res.ok,
        });
        return res;
    }

    // ---------- DKIM endpoints (GET never returns private key) ----------

    @Get("dkim")
    @RequirePerm("settings.read")
    async getDkim(@Req() req: Request) {
        this.audit(req, "dkim_get");
        const row = await this.dkimRepo.get();
        return {
            domain: row.domain,
            selector: row.selector,
            hasPrivateKey: !!row.private_key,
            updatedAt: row.updated_at,
        };
    }

    @Post("dkim")
    @RequirePerm("settings.write")
    async saveDkim(
        @Req() req: Request,
        @Body() body: { domain: string; selector: string; privateKey?: string }
    ) {
        if (!body?.domain || !body?.selector) {
            throw new BadRequestException("domain and selector are required");
        }
        await this.dkimRepo.save({
            domain: body.domain,
            selector: body.selector,
            privateKey: body.privateKey, // omit to keep existing
        });
        this.audit(req, "dkim_save", {
            domain: body.domain,
            selector: body.selector,
            withKey: !!body.privateKey,
        });
        return { ok: true };
    }

    @Get("dkim/dns-check")
    @RequirePerm("settings.read")
    async dkimDnsCheck(
        @Req() req: Request,
        @Query("domain") domain?: string,
        @Query("selector") selector?: string
    ) {
        if (!domain || !selector) {
            throw new BadRequestException("domain and selector are required");
        }
        const res = await this.svc.verifyDkimDns(domain, selector);
        this.audit(req, "dkim_dns_check", {
            domain,
            selector,
            ok: (res as any).ok,
        });
        return res;
    }

    @Get("health")
    @RequirePerm("settings.read")
    async health(@Req() req: Request, @Query("profile") profile?: EmailPurpose) {
        const p = (profile || "alerts") as EmailPurpose;
        const [smtp, imap, pop] = await Promise.all([
            this.svc.smtpHealth(p),
            this.svc.imapHealth(p),
            this.svc.testPop(p),
        ]);
        this.audit(req, "email_health", {
            profile: p,
            smtp: smtp.ok,
            imap: imap.ok,
            pop: pop.ok,
        });
        return {
            profile: p,
            smtp,
            imap,
            pop,
            timestamp: new Date().toISOString(),
        };
    }
}
