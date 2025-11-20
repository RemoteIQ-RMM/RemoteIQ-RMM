=== RemoteIQ Branding Bundle ===
Generated: 2025-11-07 12:49:55 -05:00
Repo Root: C:\Users\Last Stop\Documents\Programming Projects\RemoteIQ V7 - Ticketing

--- FILE: remoteiq-minimal-e2e/backend/src/branding/branding.controller.ts ---

// backend/src/branding/branding.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
    Req,
} from '@nestjs/common';
import { ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import type { Request } from 'express';

import { BrandingService } from "./branding.service";
import { UpdateBrandingDto } from './dto/update-branding.dto';


@ApiTags('branding')
@Controller('api/branding')
export class BrandingController {
    constructor(private readonly service: BrandingService) { }

    /* ------------------------------------------------------------------ */
    /* Read / Write settings                                               */
    /* ------------------------------------------------------------------ */

    @Get()
    @ApiOkResponse({ description: 'Current branding settings' })
    getBranding() {
        return this.service.getBranding();
    }

    @Post()
    @ApiOkResponse({ description: 'Updated branding settings' })
    updateBranding(@Body() dto: UpdateBrandingDto) {
        return this.service.updateBranding(dto);
    }

    /* ------------------------------------------------------------------ */
    /* Uploads                                                             */
    /* - General images (logos, backgrounds) -> /api/branding/upload       */
    /* - Favicon (.ico only)             -> /api/branding/upload-favicon   */
    /* Files are written to ./public/uploads and served at /static/uploads */
    /* ------------------------------------------------------------------ */

    /** Upload general image (logos, login backgrounds). Field name: `file` */
    @Post('upload')
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    const dest = join(process.cwd(), 'public', 'uploads');
                    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
                    cb(null, dest);
                },
                filename: (_req, file, cb) => {
                    const ts = Date.now();
                    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
                    cb(null, `${ts}_${safe}`);
                },
            }),
            fileFilter: (_req, file, cb) => {
                if (!/^image\//.test(file.mimetype)) {
                    return cb(new BadRequestException('Only image files are allowed'), false);
                }
                cb(null, true);
            },
            limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
        }),
    )
    uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
        if (!file) throw new BadRequestException('No file uploaded');

        const base =
            process.env.PUBLIC_BASE_URL ||
            `${req.protocol}://${req.get('host')}`;

        // NOTE: main.ts must call app.useStaticAssets(..., { prefix: '/static/' })
        return { url: `${base}/static/uploads/${file.filename}` };
    }

    /** Upload favicon (.ico only). Field name: `file` */
    @Post('upload-favicon')
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    const dest = join(process.cwd(), 'public', 'uploads');
                    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
                    cb(null, dest);
                },
                filename: (_req, file, cb) => {
                    const ts = Date.now();
                    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
                    cb(null, `${ts}_${safe}`);
                },
            }),
            fileFilter: (_req, file, cb) => {
                const isIco =
                    file.mimetype === 'image/x-icon' ||
                    file.mimetype === 'image/vnd.microsoft.icon' ||
                    extname(file.originalname).toLowerCase() === '.ico';
                if (!isIco) {
                    return cb(new BadRequestException('Only .ico files are allowed'), false);
                }
                cb(null, true);
            },
            limits: { fileSize: 512 * 1024 }, // 512KB
        }),
    )
    uploadFavicon(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
        if (!file) throw new BadRequestException('No file uploaded');

        const base =
            process.env.PUBLIC_BASE_URL ||
            `${req.protocol}://${req.get('host')}`;

        return { url: `${base}/static/uploads/${file.filename}` };
    }
}

--- FILE: remoteiq-minimal-e2e/backend/src/branding/branding.service.ts ---

// backend/src/branding/branding.service.ts
import { Injectable, OnModuleDestroy, InternalServerErrorException } from '@nestjs/common';
import { UpdateBrandingDto } from './dto/update-branding.dto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require('pg');

type BrandingRow = {
    primary_color: string | null;
    secondary_color: string | null;
    logo_light_url: string | null;
    logo_dark_url: string | null;
    login_background_url: string | null;
    favicon_url: string | null;
    email_header: string | null;
    email_footer: string | null;
    custom_css: string | null;
    allow_client_theme_toggle: boolean | null;
};

@Injectable()
export class BrandingService implements OnModuleDestroy {
    private pool: any;

    constructor() {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
            this.pool = new Pool({
                connectionString,
                ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
            });
        } else {
            this.pool = new Pool({
                host: process.env.PGHOST ?? 'localhost',
                port: Number(process.env.PGPORT ?? 5432),
                user: process.env.PGUSER ?? 'postgres',
                password: process.env.PGPASSWORD ?? undefined,
                database: process.env.PGDATABASE ?? 'remoteiq',
                ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
            });
        }
    }

    async onModuleDestroy() {
        try {
            await this.pool.end();
        } catch {
            /* no-op */
        }
    }

    private rowToApi(row: BrandingRow) {
        return {
            primaryColor: row?.primary_color ?? null,
            secondaryColor: row?.secondary_color ?? null,
            logoLightUrl: row?.logo_light_url ?? null,
            logoDarkUrl: row?.logo_dark_url ?? null,
            loginBackgroundUrl: row?.login_background_url ?? null,
            faviconUrl: row?.favicon_url ?? null,
            emailHeader: row?.email_header ?? null,
            emailFooter: row?.email_footer ?? null,
            customCss: row?.custom_css ?? null,
            allowClientThemeToggle: row?.allow_client_theme_toggle ?? null,
        };
    }

    async getBranding() {
        try {
            const sql = `
        SELECT primary_color, secondary_color,
               logo_light_url, logo_dark_url, login_background_url, favicon_url,
               email_header, email_footer, custom_css, allow_client_theme_toggle
        FROM branding_settings
        ORDER BY id DESC
        LIMIT 1
      `;
            const res = await this.pool.query(sql);
            const rows = (res?.rows ?? []) as BrandingRow[];
            const row = rows[0];
            if (!row) {
                return {
                    primaryColor: null,
                    secondaryColor: null,
                    logoLightUrl: null,
                    logoDarkUrl: null,
                    loginBackgroundUrl: null,
                    faviconUrl: null,
                    emailHeader: null,
                    emailFooter: null,
                    customCss: null,
                    allowClientThemeToggle: null,
                };
            }
            return this.rowToApi(row);
        } catch (err: any) {
            throw new InternalServerErrorException(`Failed to load branding: ${err?.message ?? err}`);
        }
    }

    async updateBranding(input: UpdateBrandingDto) {
        try {
            const sql = `
        INSERT INTO branding_settings
          (id, primary_color, secondary_color, logo_light_url, logo_dark_url, login_background_url, favicon_url,
           email_header, email_footer, custom_css, allow_client_theme_toggle)
        VALUES
          (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          primary_color = EXCLUDED.primary_color,
          secondary_color = EXCLUDED.secondary_color,
          logo_light_url = EXCLUDED.logo_light_url,
          logo_dark_url = EXCLUDED.logo_dark_url,
          login_background_url = EXCLUDED.login_background_url,
          favicon_url = EXCLUDED.favicon_url,
          email_header = EXCLUDED.email_header,
          email_footer = EXCLUDED.email_footer,
          custom_css = EXCLUDED.custom_css,
          allow_client_theme_toggle = EXCLUDED.allow_client_theme_toggle
      `;
            const values = [
                input.primaryColor ?? null,
                input.secondaryColor ?? null,
                input.logoLightUrl ?? null,
                input.logoDarkUrl ?? null,
                input.loginBackgroundUrl ?? null,
                input.faviconUrl ?? null,
                input.emailHeader ?? null,
                input.emailFooter ?? null,
                input.customCss ?? null,
                input.allowClientThemeToggle ?? null,
            ];

            await this.pool.query(sql, values);
            return this.getBranding();
        } catch (err: any) {
            throw new InternalServerErrorException(`Failed to update branding: ${err?.message ?? err}`);
        }
    }
}

--- FILE: remoteiq-minimal-e2e/backend/src/branding/branding.module.ts ---

// backend/src/branding/branding.module.ts
import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
// If you switch BrandingService to use PgPoolService, also:
// import { StorageModule } from '../storage/storage.module';

@Module({
    // imports: [StorageModule], // <- only if BrandingService uses PgPoolService
    controllers: [BrandingController],
    providers: [BrandingService],
    exports: [BrandingService],
})
export class BrandingModule { }

--- FILE: remoteiq-minimal-e2e/backend/src/branding/dto/update-branding.dto.ts ---

// backend/src/branding/dto/update-branding.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class UpdateBrandingDto {
    @ApiPropertyOptional({ example: '#3b82f6', description: 'Primary brand color (hex)' })
    @IsOptional()
    @IsString()
    @Matches(HEX, { message: 'primaryColor must be a valid hex like #1f2937 or #fff' })
    primaryColor?: string;

    @ApiPropertyOptional({ example: '#22c55e', description: 'Secondary brand color (hex)' })
    @IsOptional()
    @IsString()
    @Matches(HEX, { message: 'secondaryColor must be a valid hex like #22c55e or #0f0' })
    secondaryColor?: string;

    @ApiPropertyOptional({ example: 'https://cdn.example.com/logo-light.svg' })
    @IsOptional()
    @IsString()
    logoLightUrl?: string;

    @ApiPropertyOptional({ example: 'https://cdn.example.com/logo-dark.svg' })
    @IsOptional()
    @IsString()
    logoDarkUrl?: string;

    @ApiPropertyOptional({ example: 'https://cdn.example.com/login-bg.jpg' })
    @IsOptional()
    @IsString()
    loginBackgroundUrl?: string;

    @ApiPropertyOptional({ example: 'https://cdn.example.com/favicon.ico', description: 'Favicon (.ico) URL' })
    @IsOptional()
    @IsString()
    faviconUrl?: string;

    @ApiPropertyOptional({ description: 'HTML for email header' })
    @IsOptional()
    @IsString()
    emailHeader?: string;

    @ApiPropertyOptional({ description: 'HTML for email footer' })
    @IsOptional()
    @IsString()
    emailFooter?: string;

    @ApiPropertyOptional({ description: 'Raw CSS injected into app pages' })
    @IsOptional()
    @IsString()
    customCss?: string;

    @ApiPropertyOptional({ description: 'Allow end-users to toggle light/dark theme' })
    @IsOptional()
    @IsBoolean()
    allowClientThemeToggle?: boolean;
}

--- FILE: remoteiq-minimal-e2e/backend/src/app.module.ts ---

// remoteiq-minimal-e2e/backend/src/app.module.ts

import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";

import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { WsModule } from "./ws/ws.module";
import { AgentsModule } from "./agents/agents.module";
import { JobsModule } from "./jobs/jobs.module";
import { DevicesModule } from "./devices/devices.module";
import { HealthModule } from "./health/health.module";
import { AdminModule } from "./admin/admin.module";
import { CompanyModule } from "./company/company.module";
import { BrandingModule } from "./branding/branding.module";
import { LocalizationModule } from "./localization/localization.module";
import { SupportModule } from "./support/support.module";
import { SupportLegalModule } from "./support-legal/support-legal.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { SmtpModule } from "./smtp/smtp.module";
import { ScheduleModule } from "@nestjs/schedule";
import { ImapModule } from "./imap/imap.module";
import { SessionCleanerService } from "./maintenance/session-cleaner.service";
import { CustomersModule } from "./customers/customers.module";
import { BackupsModule } from "./backups/backups.module";

import { JwtModule } from "@nestjs/jwt";

// ✅ correct path: the middleware file is under /auth, not /common
import { AuthCookieMiddleware } from "./auth/auth-cookie.middleware";

// ✅ bring PgPoolService into the AppModule DI context
import { StorageModule } from "./storage/storage.module";

// ✅ NEW: Tickets
import { TicketsModule } from "./tickets/tickets.module";

@Module({
    imports: [
        // Static files mounted at /static -> maps to /public
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, "..", "public"),
            serveRoot: "/static",
        }),

        // JwtService for middleware
        JwtModule.register({
            secret: process.env.JWT_SECRET ?? "dev-secret",
        }),

        // Base/shared
        CommonModule,

        // ✅ Storage (PgPoolService) must be available for main.ts interceptor registration
        StorageModule,

        // Feature modules
        BrandingModule,
        AuthModule,
        WsModule,
        AgentsModule,
        JobsModule,
        DevicesModule,
        HealthModule,
        AdminModule,
        CompanyModule,
        LocalizationModule,
        SupportModule,
        SupportLegalModule,
        UsersModule,
        RolesModule,
        CustomersModule,

        // Backups Module
        BackupsModule,

        // ✅ Tickets module
        TicketsModule,

        // SMTP + IMAP
        SmtpModule,
        ScheduleModule.forRoot(),
        ImapModule,
    ],
    providers: [
        // Daily cleanup of revoked sessions
        SessionCleanerService,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // Apply cookie->req.user middleware to everything except obvious public/static routes
        consumer
            .apply(AuthCookieMiddleware)
            .exclude(
                "healthz",
                "docs",
                "docs/(.*)",
                "static/(.*)",      // static files
                "api/auth/login",   // login doesn’t need req.user
                "api/auth/logout"   // logout doesn’t need req.user
            )
            .forRoutes("*");
    }
}

--- FILE: remoteiq-minimal-e2e/backend/src/storage/pg-pool.service.ts ---

//backend\src\storage\pg-pool.service.ts

import { Injectable, OnModuleDestroy } from "@nestjs/common";

// We use require() + loose typing to avoid the “Cannot use namespace … as a type” errors
// that can happen in some TS configs when importing from 'pg'.
const { Pool } = require("pg") as { Pool: any };

export type PgRuntimeConfig = {
    connectionString?: string;
    ssl?: boolean | object;
    max?: number;
    min?: number;
};

@Injectable()
export class PgPoolService implements OnModuleDestroy {
    private pool: any = null;
    private lastKey: string | null = null;

    /** Build a default config from env (used on first access if not configured) */
    private envConfig(): PgRuntimeConfig {
        const url =
            process.env.DATABASE_URL ||
            process.env.PG_URL ||
            "postgres://remoteiq:remoteiqpass@localhost:5432/remoteiq";

        const ssl =
            (process.env.DATABASE_SSL ?? "").toLowerCase() === "true" ? true : false;

        const max = Number.isFinite(+process.env.DATABASE_POOL_MAX!)
            ? Number(process.env.DATABASE_POOL_MAX)
            : 10;
        const min = Number.isFinite(+process.env.DATABASE_POOL_MIN!)
            ? Number(process.env.DATABASE_POOL_MIN)
            : 0;

        return { connectionString: url, ssl, max, min };
    }

    /** Create a stable key for the current config so we can know when to recreate the pool */
    private keyOf(cfg: PgRuntimeConfig): string {
        return JSON.stringify({
            cs: cfg.connectionString ?? "",
            ssl: cfg.ssl ? "1" : "0",
            max: cfg.max ?? 10,
            min: cfg.min ?? 0,
        });
    }

    private makePool(cfg: PgRuntimeConfig): any {
        const base: any = {
            connectionString: cfg.connectionString,
            max: cfg.max ?? 10,
            min: cfg.min ?? 0,
        };
        if (cfg.ssl) {
            base.ssl = cfg.ssl === true ? { rejectUnauthorized: false } : cfg.ssl;
        }
        return new Pool(base);
    }

    /** Ensure pool exists; create from env if needed */
    private ensurePool(): any {
        if (!this.pool) {
            const cfg = this.envConfig();
            this.lastKey = this.keyOf(cfg);
            this.pool = this.makePool(cfg);
        }
        return this.pool!;
    }

    /**
     * Called by admin bootstrap when the database config changes.
     * Recreates the pool if the effective config differs.
     */
    configure(cfg: PgRuntimeConfig) {
        const nextKey = this.keyOf(cfg);
        if (this.pool && this.lastKey === nextKey) return; // no-op

        // tear down previous pool
        if (this.pool) {
            try {
                this.pool.end().catch(() => { });
            } catch { }
            this.pool = null;
        }

        this.pool = this.makePool(cfg);
        this.lastKey = nextKey;
    }

    async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
        const res = await this.ensurePool().query(text, params);
        return { rows: res.rows as T[], rowCount: typeof res.rowCount === "number" ? res.rowCount : 0 };
    }

    async onModuleDestroy() {
        if (this.pool) {
            try {
                await this.pool.end();
            } catch { }
            this.pool = null;
        }
    }
}

--- FILE: remoteiq-frontend/app/providers/BrandingProvider.tsx ---

"use client";

import * as React from "react";

/**
 * Branding shape coming from GET /api/branding
 */
export interface Branding {
    primaryColor: string;
    secondaryColor: string;
    logoLightUrl: string;
    logoDarkUrl: string;
    loginBackgroundUrl: string;
    faviconUrl: string; // may be empty
    emailHeader: string;
    emailFooter: string;
    customCss: string;
    allowClientThemeToggle: boolean;
}

type PreviewPatch = Partial<Pick<Branding, "primaryColor" | "secondaryColor" | "faviconUrl">>;

interface BrandingContextType {
    branding: Branding | null;
    isLoaded: boolean;
    applyPreview: (patch: PreviewPatch) => void;
    clearPreview: () => void;
    refetch: () => Promise<void>;
}

const BrandingContext = React.createContext<BrandingContextType | undefined>(undefined);

const DEFAULT_PRIMARY = "#3b82f6";
const DEFAULT_SECONDARY = "#22c55e";
const DEFAULT_FAVICON = "/favicon.ico"; // <- default from public/
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/* ====================== CSS Var helpers ====================== */

function setCssVar(name: string, value: string) {
    document.documentElement.style.setProperty(name, value);
}

// converts hex -> hsl tuple string: "210 100% 56%"
function hexToHslTuple(hex: string): string {
    if (!HEX.test(hex)) {
        return "0 0% 0%";
    }
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let hh = 0;
    let s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                hh = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                hh = (b - r) / d + 2;
                break;
            default:
                hh = (r - g) / d + 4;
        }
        hh /= 6;
    }

    const H = Math.round(hh * 360);
    const S = Math.round(s * 100);
    const L = Math.round(l * 100);
    return `${H} ${S}% ${L}%`;
}

/* ====================== Favicon helpers ====================== */

function ensureFaviconLink(): HTMLLinkElement {
    // Prefer rel="icon", but also handle existing "shortcut icon"
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
    }
    return link;
}

function setFavicon(href: string) {
    const link = ensureFaviconLink();
    link.href = href || DEFAULT_FAVICON;
}

/* ====================== Provider ====================== */

export function BrandingProvider({ children }: { children: React.ReactNode }) {
    const [branding, setBranding] = React.useState<Branding | null>(null);
    const [isLoaded, setIsLoaded] = React.useState(false);

    const applyThemeVars = React.useCallback((b: Branding | null) => {
        const primary = b?.primaryColor || DEFAULT_PRIMARY;
        const secondary = b?.secondaryColor || DEFAULT_SECONDARY;
        setCssVar("--primary", hexToHslTuple(primary));
        setCssVar("--secondary", hexToHslTuple(secondary));
    }, []);

    const applyInitialFavicon = React.useCallback((b: Branding | null) => {
        const src = b?.faviconUrl?.trim() || DEFAULT_FAVICON;
        setFavicon(src);
    }, []);

    const fetchBranding = React.useCallback(async () => {
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/branding`, {
                method: "GET",
                credentials: "include",
                headers: { "Accept": "application/json" },
            });
            if (!res.ok) {
                throw new Error(`GET /api/branding failed: ${res.status}`);
            }
            const data = (await res.json()) as Branding;
            setBranding(data);
            // apply CSS + favicon
            applyThemeVars(data);
            applyInitialFavicon(data);
        } catch (e) {
            // fall back to defaults if fetch fails
            setBranding({
                primaryColor: DEFAULT_PRIMARY,
                secondaryColor: DEFAULT_SECONDARY,
                logoLightUrl: "",
                logoDarkUrl: "",
                loginBackgroundUrl: "",
                faviconUrl: "",
                emailHeader: "<h1>{{org_name}}</h1>",
                emailFooter: "<p>Copyright 2025. All rights reserved.</p>",
                customCss: "/* ... */",
                allowClientThemeToggle: true,
            });
            applyThemeVars(null);
            applyInitialFavicon(null);
            // eslint-disable-next-line no-console
            console.warn(e);
        } finally {
            setIsLoaded(true);
        }
    }, [applyInitialFavicon, applyThemeVars]);

    React.useEffect(() => {
        fetchBranding();
    }, [fetchBranding]);

    /**
     * applyPreview:
     * - Accepts partial { primaryColor?, secondaryColor?, faviconUrl? }
     * - Applies CSS vars and/or favicon temporarily without mutating `branding`.
     */
    const applyPreview = React.useCallback(
        (patch: PreviewPatch) => {
            if (patch.primaryColor) {
                setCssVar("--primary", hexToHslTuple(patch.primaryColor));
            }
            if (patch.secondaryColor) {
                setCssVar("--secondary", hexToHslTuple(patch.secondaryColor));
            }
            if (patch.faviconUrl !== undefined) {
                setFavicon(patch.faviconUrl?.trim() || DEFAULT_FAVICON);
            }
        },
        []
    );

    /**
     * clearPreview:
     * - Reapplies CSS vars + favicon from the current saved branding (or defaults)
     */
    const clearPreview = React.useCallback(() => {
        applyThemeVars(branding);
        applyInitialFavicon(branding);
    }, [applyInitialFavicon, applyThemeVars, branding]);

    const value: BrandingContextType = React.useMemo(
        () => ({ branding, isLoaded, applyPreview, clearPreview, refetch: fetchBranding }),
        [branding, isLoaded, applyPreview, clearPreview, fetchBranding]
    );

    return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
    const ctx = React.useContext(BrandingContext);
    if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
    return ctx;
}

--- FILE: remoteiq-frontend/app/administration/tabs/BrandingTab.tsx ---

"use client";

/**
 * Branding & Appearance
 * -----------------------------------------------------------------------------
 * Two fixed columns with neatly aligned rows of paired cards:
 *
 * Row 1:  Colors                             |  Header Preview (no top bar)
 * Row 2:  Logos                               |  Logos Preview (side-by-side)
 * Row 3:  Login Background                    |  Login Page Preview
 * Row 4:  Favicon (.ico)                      |  Favicon Preview
 * Row 5:  Email Header HTML                   |  Email Footer HTML
 * Row 6:  Custom CSS  (spans both columns)
 *
 * Each pair is rendered in a "PairRow" grid with items stretch + Cards set to
 * h-full so both sides align to equal heights. On small screens everything
 * stacks naturally; on md+ screens you get perfect 2-column alignment.
 */

import * as React from "react";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
    Palette,
    Image as ImageIcon,
    Star as FaviconIcon,
    Pipette,
    Info as InfoIcon,
    MonitorSmartphone,
    ImagePlus,
} from "lucide-react";
import { LabeledTextarea, CheckToggle } from "../helpers";
import { ToastFn } from "../types";
import { useBranding } from "@/app/providers/BrandingProvider";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/* =============================================================================
 * Types / Props
 * ========================================================================== */
interface BrandingTabProps {
    push: ToastFn;
}

/* =============================================================================
 * Helpers: color conversions
 * ========================================================================== */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = "image/*";
const ACCEPTED_FAVICON_TYPES = ".ico,image/x-icon";

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    if (!HEX.test(hex)) return null;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r: number, g: number, b: number) {
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${toHex(clamp(Math.round(r), 0, 255))}${toHex(
        clamp(Math.round(g), 0, 255)
    )}${toHex(clamp(Math.round(b), 0, 255))}`;
}
function rgbToHsl(r: number, g: number, b: number) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    let h = 0,
        s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        switch (max) {
            case r:
                h = ((g - b) / d) % 6;
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            default:
                h = (r - g) / d + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }
    return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToRgb(h: number, s: number, l: number) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0,
        g1 = 0,
        b1 = 0;
    if (0 <= h && h < 60) [r1, g1, b1] = [c, x, 0];
    else if (60 <= h && h < 120) [r1, g1, b1] = [x, c, 0];
    else if (120 <= h && h < 180) [r1, g1, b1] = [0, c, x];
    else if (180 <= h && h < 240) [r1, g1, b1] = [0, x, c];
    else if (240 <= h && h < 300) [r1, g1, b1] = [x, 0, c];
    else[r1, g1, b1] = [c, 0, x];
    const r = (r1 + m) * 255,
        g = (g1 + m) * 255,
        b = (b1 + m) * 255;
    return { r, g, b };
}
function hexToHsl(hex: string) {
    const rgb = hexToRgb(hex);
    if (!rgb) return { h: 0, s: 0, l: 0 };
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
}
function hslToHex(h: number, s: number, l: number) {
    const { r, g, b } = hslToRgb(h, s, l);
    return rgbToHex(r, g, b);
}

/* =============================================================================
 * EyeDropper typings
 * ========================================================================== */
interface NativeEyeDropper {
    open: () => Promise<{ sRGBHex: string }>;
}
declare global {
    interface Window {
        EyeDropper?: new () => NativeEyeDropper;
    }
}

/* =============================================================================
 * PairRow – 2 equal-height columns per row
 * ========================================================================== */
function PairRow({ children }: { children: React.ReactNode }) {
    return (
        <div className="grid md:grid-cols-2 gap-6 items-stretch">{children}</div>
    );
}

/* =============================================================================
 * ColorPicker (modal with screen eyedropper)
 * ========================================================================== */
function ColorPicker({
    label,
    value,
    onChange,
    error,
    className,
    triggerClassName,
}: {
    label: string;
    value: string;
    onChange: (hex: string) => void;
    error?: string;
    className?: string;
    triggerClassName?: string;
}) {
    const [open, setOpen] = React.useState(false);
    const [hex, setHex] = React.useState<string>(value || "#000000");
    const [{ h, s, l }, setHsl] = React.useState(() => hexToHsl(value || "#000000"));
    const PRESETS = React.useMemo(
        () => [
            "#3b82f6",
            "#22c55e",
            "#ef4444",
            "#a855f7",
            "#06b6d4",
            "#f59e0b",
            "#111827",
            "#4b5563",
            "#9ca3af",
            "#ffffff",
        ],
        []
    );

    // Always-mounted fallback color input (for non-supporting browsers)
    const colorFallbackRef = React.useRef<HTMLInputElement | null>(null);
    const reopenTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
        if (open) {
            const safeHex = HEX.test(value) ? value : "#000000";
            setHex(safeHex);
            setHsl(hexToHsl(safeHex));
        }
        return () => {
            if (reopenTimerRef.current) {
                clearTimeout(reopenTimerRef.current);
                reopenTimerRef.current = null;
            }
        };
    }, [open, value]);

    const onHexChange = (v: string) => {
        setHex(v);
        if (HEX.test(v)) setHsl(hexToHsl(v));
    };

    // NEW: keep HEX in sync while dragging sliders
    const setHslAndHex = (next: Partial<{ h: number; s: number; l: number }>) => {
        const nh = clamp(next.h ?? h, 0, 360);
        const ns = clamp(next.s ?? s, 0, 100);
        const nl = clamp(next.l ?? l, 0, 100);
        setHsl({ h: nh, s: ns, l: nl });
        setHex(hslToHex(nh, ns, nl));
    };

    const apply = () => {
        if (!HEX.test(hex)) return;
        onChange(hex);
        setOpen(false);
    };

    const hueGradient =
        "linear-gradient(90deg, red, #ff0, #0f0, #0ff, #00f, #f0f, red)";
    const satGradient = `linear-gradient(90deg, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`;
    const lightGradient = `linear-gradient(90deg, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))`;

    const pickFromScreen = async () => {
        const hasEyeDropper =
            typeof window !== "undefined" && !!window.EyeDropper;

        // Close the modal so users can click elements behind it
        setOpen(false);
        await new Promise((r) => setTimeout(r, 120));

        if (hasEyeDropper) {
            try {
                const eye = new window.EyeDropper!();
                const result = await eye.open();
                const picked = (result?.sRGBHex || "").toLowerCase();
                if (HEX.test(picked)) {
                    setHex(picked);
                    setHsl(hexToHsl(picked));
                    onChange(picked);
                }
            } catch {
                // user canceled -> ignore
            } finally {
                setOpen(true);
            }
        } else {
            const input = colorFallbackRef.current;
            if (!input) {
                setOpen(true);
                return;
            }

            const cleanupAndReopen = () => {
                input.removeEventListener("change", handleChange);
                window.removeEventListener("focus", reopenGuard, true);
                if (reopenTimerRef.current) {
                    clearTimeout(reopenTimerRef.current);
                    reopenTimerRef.current = null;
                }
                setOpen(true);
            };

            const handleChange = (e: Event) => {
                const target = e.target as HTMLInputElement;
                const val = (target?.value || "").toLowerCase();
                if (HEX.test(val)) {
                    setHex(val);
                    setHsl(hexToHsl(val));
                    onChange(val);
                }
                cleanupAndReopen();
            };
            const reopenGuard = () => cleanupAndReopen();

            input.addEventListener("change", handleChange, { once: true });
            window.addEventListener("focus", reopenGuard, { once: true, capture: true });
            reopenTimerRef.current = setTimeout(() => cleanupAndReopen(), 2500);
            input.click();
        }
    };

    return (
        <div className={cn("grid gap-1", className)}>
            {/* Hidden fallback color input */}
            <input
                ref={colorFallbackRef}
                type="color"
                value={HEX.test(hex) ? hex : "#000000"}
                onChange={(e) => onHexChange(e.target.value)}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
            />

            <span className="text-sm">{label}</span>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button
                        variant="outline"
                        className={cn("justify-start gap-3 h-9 font-mono text-xs", triggerClassName)}
                        type="button"
                        aria-label={`${label}: ${value || "Select color"}`}
                    >
                        <span
                            className="h-5 w-5 rounded border"
                            style={{ background: HEX.test(value) ? value : "#ffffff" }}
                        />
                        {value || "Select…"}
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>{label}</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-5">
                        {/* Preview + Eyedropper */}
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="h-12 w-12 rounded-md border" style={{ background: hex }} />
                                <div className="text-xs text-muted-foreground">
                                    <div>
                                        HEX: <span className="font-mono">{hex}</span>
                                    </div>
                                    <div>
                                        HSL:{" "}
                                        <span className="font-mono">
                                            {h}°, {s}%, {l}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <Button type="button" variant="secondary" onClick={pickFromScreen}>
                                <Pipette className="h-4 w-4 mr-1" />
                                Pick from screen
                            </Button>
                        </div>

                        {/* Hue */}
                        <div className="grid gap-2">
                            <label className="text-xs text-muted-foreground">Hue ({h}°)</label>
                            <div className="rounded h-2" style={{ background: hueGradient }} />
                            <Slider
                                value={[h]}
                                max={360}
                                step={1}
                                onValueChange={(v: number[]) => setHslAndHex({ h: v[0] })}
                                aria-label="Hue"
                            />
                        </div>

                        {/* Saturation */}
                        <div className="grid gap-2">
                            <label className="text-xs text-muted-foreground">Saturation ({s}%)</label>
                            <div className="rounded h-2" style={{ background: satGradient }} />
                            <Slider
                                value={[s]}
                                max={100}
                                step={1}
                                onValueChange={(v: number[]) => setHslAndHex({ s: v[0] })}
                                aria-label="Saturation"
                            />
                        </div>

                        {/* Lightness */}
                        <div className="grid gap-2">
                            <label className="text-xs text-muted-foreground">Lightness ({l}%)</label>
                            <div className="rounded h-2" style={{ background: lightGradient }} />
                            <Slider
                                value={[l]}
                                max={100}
                                step={1}
                                onValueChange={(v: number[]) => setHslAndHex({ l: v[0] })}
                                aria-label="Lightness"
                            />
                        </div>

                        {/* Hex input */}
                        <div className="grid gap-2">
                            <label className="text-xs text-muted-foreground">Hex</label>
                            <Input
                                value={hex}
                                onChange={(e) => onHexChange(e.target.value)}
                                placeholder="#3b82f6"
                                className={!HEX.test(hex) ? "border-red-500" : undefined}
                                aria-invalid={!HEX.test(hex)}
                            />
                            {!HEX.test(hex) && (
                                <p className="text-xs text-red-600">Use a valid hex (e.g. #3b82f6 or #fff)</p>
                            )}
                        </div>

                        {/* Presets */}
                        <div className="grid gap-2">
                            <label className="text-xs text-muted-foreground">Presets</label>
                            <div className="grid grid-cols-10 gap-2">
                                {PRESETS.map((c) => (
                                    <button
                                        key={c}
                                        onClick={() => {
                                            setHex(c);
                                            setHsl(hexToHsl(c));
                                        }}
                                        className={cn(
                                            "h-7 w-7 rounded border",
                                            hex.toLowerCase() === c ? "ring-2 ring-offset-2 ring-primary" : ""
                                        )}
                                        style={{ background: c }}
                                        aria-label={`Preset ${c}`}
                                        type="button"
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                            <Button variant="ghost" onClick={() => setOpen(false)} type="button">
                                Cancel
                            </Button>
                            <Button onClick={apply} disabled={!HEX.test(hex)} type="button">
                                Apply
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    );
}

/* =============================================================================
 * Main Component
 * ========================================================================== */
export default function BrandingTab({ push }: BrandingTabProps) {
    const { branding, isLoaded, applyPreview, clearPreview, refetch } = useBranding();

    // Form state mirrors server payload
    const [primaryColor, setPrimaryColor] = React.useState("#09090b");
    const [secondaryColor, setSecondaryColor] = React.useState("#fafafa");
    const [logoLightUrl, setLogoLightUrl] = React.useState("");
    const [logoDarkUrl, setLogoDarkUrl] = React.useState("");
    const [loginBackgroundUrl, setLoginBackgroundUrl] = React.useState("");
    const [faviconUrl, setFaviconUrl] = React.useState("");
    const [emailHeader, setEmailHeader] = React.useState("<h1>{{org_name}}</h1>");
    const [emailFooter, setEmailFooter] = React.useState(
        "<p>Copyright 2025. All rights reserved.</p>"
    );
    const [customCss, setCustomCss] = React.useState("/* Your custom CSS here */");
    const [allowClientThemeToggle, setAllowClientThemeToggle] =
        React.useState(true);

    const [errors, setErrors] = React.useState<{ primary?: string; secondary?: string }>(
        {}
    );
    const [uploadingLight, setUploadingLight] = React.useState(false);
    const [uploadingDark, setUploadingDark] = React.useState(false);
    const [uploadingLoginBg, setUploadingLoginBg] = React.useState(false);
    const [uploadingFavicon, setUploadingFavicon] = React.useState(false);

    const lightInputRef = React.useRef<HTMLInputElement | null>(null);
    const darkInputRef = React.useRef<HTMLInputElement | null>(null);
    const loginBgInputRef = React.useRef<HTMLInputElement | null>(null);
    const faviconInputRef = React.useRef<HTMLInputElement | null>(null);

    React.useEffect(() => {
        if (!isLoaded) return;
        setPrimaryColor(branding?.primaryColor ?? "#09090b");
        setSecondaryColor(branding?.secondaryColor ?? "#fafafa");
        setLogoLightUrl(branding?.logoLightUrl ?? "");
        setLogoDarkUrl(branding?.logoDarkUrl ?? "");
        setLoginBackgroundUrl(branding?.loginBackgroundUrl ?? "");
        setFaviconUrl(branding?.faviconUrl ?? "");
        setEmailHeader(branding?.emailHeader ?? "<h1>{{org_name}}</h1>");
        setEmailFooter(
            branding?.emailFooter ?? "<p>Copyright 2025. All rights reserved.</p>"
        );
        setCustomCss(branding?.customCss ?? "/* Your custom CSS here */");
        setAllowClientThemeToggle(branding?.allowClientThemeToggle ?? true);
    }, [isLoaded, branding]);

    // Live color preview
    React.useEffect(() => {
        applyPreview({ primaryColor, secondaryColor });
    }, [primaryColor, secondaryColor, applyPreview]);

    function validate(): boolean {
        const next: { primary?: string; secondary?: string } = {};
        if (!HEX.test(primaryColor))
            next.primary = "Use a valid hex (e.g. #1f2937 or #fff)";
        if (!HEX.test(secondaryColor))
            next.secondary = "Use a valid hex (e.g. #22c55e or #0f0)";
        setErrors(next);
        return Object.keys(next).length === 0;
    }

    async function uploadImage(file: File): Promise<string> {
        if (!file) throw new Error("No file selected");
        if (file.size > MAX_UPLOAD_BYTES) throw new Error("File too large (5MB max)");
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/branding/upload`, {
            method: "POST",
            credentials: "include",
            body: fd,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const data = (await res.json()) as { url?: string };
        if (!data?.url) throw new Error("Upload did not return a URL");
        return data.url;
    }

    async function uploadFavicon(file: File): Promise<string> {
        if (!file) throw new Error("No file selected");
        if (!file.name.toLowerCase().endsWith(".ico"))
            throw new Error("Only .ico files are allowed");
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_BASE}/api/branding/upload-favicon`,
            {
                method: "POST",
                credentials: "include",
                body: fd,
            }
        );
        if (!res.ok) throw new Error(`Favicon upload failed (${res.status})`);
        const data = (await res.json()) as { url?: string };
        if (!data?.url) throw new Error("Upload did not return a URL");
        return data.url;
    }

    async function onUpload(which: "light" | "dark" | "loginBg", file: File | null) {
        if (!file) return;
        try {
            if (which === "light") setUploadingLight(true);
            else if (which === "dark") setUploadingDark(true);
            else setUploadingLoginBg(true);

            const url = await uploadImage(file);
            if (which === "light") setLogoLightUrl(url);
            else if (which === "dark") setLogoDarkUrl(url);
            else setLoginBackgroundUrl(url);

            push({ title: "Image uploaded", kind: "success" });
        } catch (e) {
            push({
                title: "Upload failed",
                desc: String((e as Error)?.message ?? e),
                kind: "destructive",
            });
        } finally {
            if (which === "light") setUploadingLight(false);
            else if (which === "dark") setUploadingDark(false);
            else setUploadingLoginBg(false);
        }
    }

    async function onUploadFavicon(file: File | null) {
        if (!file) return;
        try {
            setUploadingFavicon(true);
            const url = await uploadFavicon(file);
            setFaviconUrl(url);
            push({ title: "Favicon uploaded", kind: "success" });
        } catch (e) {
            push({
                title: "Upload failed",
                desc: String((e as Error)?.message ?? e),
                kind: "destructive",
            });
        } finally {
            setUploadingFavicon(false);
        }
    }

    async function onSave() {
        if (!validate()) {
            push({ title: "Please fix the color fields", kind: "destructive" });
            return;
        }
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/branding`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    primaryColor,
                    secondaryColor,
                    logoLightUrl,
                    logoDarkUrl,
                    loginBackgroundUrl,
                    faviconUrl,
                    emailHeader,
                    emailFooter,
                    customCss,
                    allowClientThemeToggle,
                }),
            });
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
            push({ title: "Branding settings saved", kind: "success" });
            await refetch();
            clearPreview();
        } catch (e) {
            push({
                title: "Save failed",
                desc: String((e as Error)?.message ?? e),
                kind: "destructive",
            });
        }
    }

    function onResetPreview() {
        if (!branding) return;
        setPrimaryColor(branding.primaryColor ?? "#09090b");
        setSecondaryColor(branding.secondaryColor ?? "#fafafa");
        setLogoLightUrl(branding.logoLightUrl ?? "");
        setLogoDarkUrl(branding.logoDarkUrl ?? "");
        setLoginBackgroundUrl(branding.loginBackgroundUrl ?? "");
        setFaviconUrl(branding.faviconUrl ?? "");
        setEmailHeader(branding.emailHeader ?? "<h1>{{org_name}}</h1>");
        setEmailFooter(
            branding.emailFooter ?? "<p>Copyright 2025. All rights reserved.</p>"
        );
        setCustomCss(branding.customCss ?? "/* Your custom CSS here */");
        setAllowClientThemeToggle(branding.allowClientThemeToggle ?? true);
        clearPreview();
    }

    return (
        <TabsContent value="branding" className="mt-0">
            <Card>
                <CardHeader>
                    <CardTitle>Branding & Appearance</CardTitle>
                    <CardDescription>
                        Configure brand colors, logos, login artwork, favicon, and email templates. Everything is laid out in tidy paired cards for a clean overview.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* Row 1 — Colors | Header Preview (NO top bar preview) */}
                    <PairRow>
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Palette className="h-4 w-4" />
                                    Colors
                                </CardTitle>
                                <CardDescription>Define primary & secondary tokens. These drive CSS variables used by shadcn/ui and Tailwind utilities.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <ColorPicker
                                        label="Primary Color"
                                        value={primaryColor}
                                        onChange={setPrimaryColor}
                                        error={errors.primary}
                                    />
                                    <ColorPicker
                                        label="Secondary Color"
                                        value={secondaryColor}
                                        onChange={setSecondaryColor}
                                        error={errors.secondary}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground flex items-start gap-2">
                                    <MonitorSmartphone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    Use the droplet to sample any visible pixel on the page. If unsupported, the OS color dialog opens instead.
                                </p>
                            </CardContent>
                        </Card>

                        {/* Header preview WITHOUT top bar (top bar color is not adjustable) */}
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Header Preview</CardTitle>
                                <CardDescription>Demonstrates logo swap and components using your colors (no top bar shown).</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="rounded-md border p-4">
                                    <div className="flex items-center gap-3 mb-4">
                                        <picture>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <source srcSet={logoDarkUrl || ""} media="(prefers-color-scheme: dark)" />
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={
                                                    logoLightUrl ||
                                                    logoDarkUrl ||
                                                    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                                                }
                                                alt="Logo preview"
                                                className="h-7 w-auto object-contain"
                                            />
                                        </picture>
                                        <span className="text-sm opacity-90">RemoteIQ</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="rounded-md px-3 py-2 text-sm font-medium"
                                            style={{ background: primaryColor, color: "#fff" }}
                                        >
                                            Primary
                                        </button>
                                        <button
                                            className="rounded-md px-3 py-2 text-sm font-medium"
                                            style={{ background: secondaryColor, color: "#111" }}
                                        >
                                            Secondary
                                        </button>
                                    </div>
                                    <div className="mt-4 grid gap-2">
                                        <div className="h-2 w-48 rounded" style={{ background: primaryColor }} />
                                        <div className="h-2 w-40 rounded" style={{ background: secondaryColor }} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </PairRow>

                    {/* Row 2 — Logos | Logos Preview */}
                    <PairRow>
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <ImageIcon className="h-4 w-4" />
                                    Logos
                                </CardTitle>
                                <CardDescription>Upload or paste URLs for light/dark logos. The app picks the right logo based on theme.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Light logo */}
                                <div className="grid gap-2">
                                    <label className="text-sm">Light Logo</label>
                                    <div className="grid grid-cols-[1fr_auto] gap-2">
                                        <Input
                                            value={logoLightUrl}
                                            onChange={(e) => setLogoLightUrl(e.target.value)}
                                            placeholder="https://cdn.example.com/logo-light.svg"
                                            aria-label="Light logo URL"
                                        />
                                        <div className="flex items-center">
                                            <input
                                                ref={lightInputRef}
                                                type="file"
                                                accept={ACCEPTED_IMAGE_TYPES}
                                                className="hidden"
                                                onChange={(e) => onUpload("light", e.target.files?.[0] ?? null)}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={uploadingLight}
                                                onClick={() => lightInputRef.current?.click()}
                                            >
                                                {uploadingLight ? "Uploading…" : "Upload"}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Dark logo */}
                                <div className="grid gap-2">
                                    <label className="text-sm">Dark Logo</label>
                                    <div className="grid grid-cols-[1fr_auto] gap-2">
                                        <Input
                                            value={logoDarkUrl}
                                            onChange={(e) => setLogoDarkUrl(e.target.value)}
                                            placeholder="https://cdn.example.com/logo-dark.svg"
                                            aria-label="Dark logo URL"
                                        />
                                        <div className="flex items-center">
                                            <input
                                                ref={darkInputRef}
                                                type="file"
                                                accept={ACCEPTED_IMAGE_TYPES}
                                                className="hidden"
                                                onChange={(e) => onUpload("dark", e.target.files?.[0] ?? null)}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={uploadingDark}
                                                onClick={() => darkInputRef.current?.click()}
                                            >
                                                {uploadingDark ? "Uploading…" : "Upload"}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <p className="text-xs text-muted-foreground flex items-start gap-2">
                                    <ImagePlus className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    Prefer SVGs with transparent backgrounds for crisp rendering across DPIs.
                                </p>
                            </CardContent>
                        </Card>

                        {/* Logos Preview — side by side */}
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Logos Preview</CardTitle>
                                <CardDescription>
                                    Side by side with theme-accurate backgrounds. Light sits on the light background; Dark sits on the dark background.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-full">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-full">
                                    {/* Light tile */}
                                    <div className="rounded-md border p-4 flex flex-col">
                                        <div className="text-sm font-medium mb-2">Light</div>
                                        <div
                                            className="flex-1 rounded-md border grid place-items-center overflow-hidden"
                                            style={{ background: "#ffffff" }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={
                                                    logoLightUrl ||
                                                    logoDarkUrl ||
                                                    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                                                }
                                                alt="Light logo preview"
                                                className="w-auto object-contain max-h-24 md:max-h-28 lg:max-h-40 max-w-[90%]"
                                            />
                                        </div>
                                    </div>

                                    {/* Dark tile */}
                                    <div className="rounded-md border p-4 flex flex-col dark">
                                        <div className="text-sm font-medium mb-2">Dark</div>
                                        <div
                                            className="flex-1 rounded-md border grid place-items-center overflow-hidden"
                                            style={{ background: "hsl(var(--background))" }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={
                                                    logoDarkUrl ||
                                                    logoLightUrl ||
                                                    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                                                }
                                                alt="Dark logo preview"
                                                className="w-auto object-contain max-h-24 md:max-h-28 lg:max-h-40 max-w-[90%]"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </PairRow>

                    {/* Row 3 — Login Background | Login Page Preview */}
                    <PairRow>
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <ImageIcon className="h-4 w-4" />
                                    Login Background
                                </CardTitle>
                                <CardDescription>Set the image behind the login card. We apply a subtle overlay for readability.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <label className="text-sm">Login Background URL</label>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <Input
                                        value={loginBackgroundUrl}
                                        onChange={(e) => setLoginBackgroundUrl(e.target.value)}
                                        placeholder="https://cdn.example.com/login-bg.jpg"
                                        aria-label="Login background URL"
                                    />
                                    <div className="flex items-center">
                                        <input
                                            ref={loginBgInputRef}
                                            type="file"
                                            accept={ACCEPTED_IMAGE_TYPES}
                                            className="hidden"
                                            onChange={(e) => onUpload("loginBg", e.target.files?.[0] ?? null)}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={uploadingLoginBg}
                                            onClick={() => loginBgInputRef.current?.click()}
                                        >
                                            {uploadingLoginBg ? "Uploading…" : "Upload"}
                                        </Button>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Use a large image (e.g., 1920×1080) to avoid pixelation on wide screens.
                                </p>
                            </CardContent>
                        </Card>

                        {/* Login preview */}
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Login Page Preview</CardTitle>
                                <CardDescription>Shows background coverage and primary-colored submit button.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div
                                    className="rounded-md border overflow-hidden relative"
                                    style={{
                                        height: 220,
                                        backgroundColor: "var(--background)",
                                        backgroundImage: loginBackgroundUrl ? `url(${loginBackgroundUrl})` : undefined,
                                        backgroundSize: "cover",
                                        backgroundPosition: "center",
                                    }}
                                >
                                    {loginBackgroundUrl && <div className="absolute inset-0 bg-black/30" />}
                                    <div className="absolute inset-0 flex items-center justify-center p-4">
                                        <div className="w-full max-w-[260px] rounded-xl border bg-card/90 backdrop-blur p-4 shadow">
                                            <div className="flex items-center gap-2 mb-3">
                                                <picture>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <source srcSet={logoDarkUrl || ""} media="(prefers-color-scheme: dark)" />
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={
                                                            logoLightUrl ||
                                                            logoDarkUrl ||
                                                            "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                                                        }
                                                        alt="Logo preview"
                                                        className="h-6 w-auto object-contain"
                                                    />
                                                </picture>
                                                <span className="text-sm opacity-80">RemoteIQ</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="h-9 rounded bg-muted" />
                                                <div className="h-9 rounded bg-muted" />
                                                <div className="h-9 rounded" style={{ background: primaryColor }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </PairRow>

                    {/* Row 4 — Favicon | Favicon Preview */}
                    <PairRow>
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <FaviconIcon className="h-4 w-4" />
                                    Favicon
                                </CardTitle>
                                <CardDescription>Upload a .ico or paste a URL. A default favicon is used if none is set.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <label className="text-sm">Favicon URL (.ico)</label>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <Input
                                        value={faviconUrl}
                                        onChange={(e) => setFaviconUrl(e.target.value)}
                                        placeholder="https://cdn.example.com/favicon.ico"
                                        aria-label="Favicon URL"
                                    />
                                    <div className="flex items-center">
                                        <input
                                            ref={faviconInputRef}
                                            type="file"
                                            accept={ACCEPTED_FAVICON_TYPES}
                                            className="hidden"
                                            onChange={(e) => onUploadFavicon(e.target.files?.[0] ?? null)}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={uploadingFavicon}
                                            onClick={() => faviconInputRef.current?.click()}
                                        >
                                            {uploadingFavicon ? "Uploading…" : "Upload .ico"}
                                        </Button>
                                    </div>
                                </div>

                                <p className="text-xs text-muted-foreground flex items-start gap-2">
                                    <InfoIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    Must be an .ico file for upload. You may also link to an external .ico via URL.
                                </p>
                            </CardContent>
                        </Card>

                        {/* Favicon preview */}
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Favicon Preview</CardTitle>
                                <CardDescription>Scaled similarly to a browser tab icon.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {faviconUrl ? (
                                    <div className="flex items-center gap-3">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={faviconUrl} alt="favicon" width={24} height={24} className="rounded" />
                                        <code className="text-xs break-all">{faviconUrl}</code>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        No favicon set — the application will use its default until you upload or link one.
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </PairRow>

                    {/* Row 5 — Email Header HTML | Email Footer HTML */}
                    <PairRow>
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Email Header HTML</CardTitle>
                                <CardDescription>Template snippet injected at the start of outbound emails.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <LabeledTextarea
                                    label="Email Header HTML"
                                    value={emailHeader}
                                    onChange={setEmailHeader}
                                    rows={8}
                                />
                            </CardContent>
                        </Card>

                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-base">Email Footer HTML</CardTitle>
                                <CardDescription>Footer markup appended to outbound emails.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <LabeledTextarea
                                    label="Email Footer HTML"
                                    value={emailFooter}
                                    onChange={setEmailFooter}
                                    rows={8}
                                />
                            </CardContent>
                        </Card>
                    </PairRow>

                    {/* Row 6 — Custom CSS (full width) */}
                    <Card className="h-full">
                        <CardHeader>
                            <CardTitle className="text-base">Custom CSS</CardTitle>
                            <CardDescription>Advanced overrides get injected after the theme variables.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <LabeledTextarea
                                label="Custom CSS"
                                value={customCss}
                                onChange={setCustomCss}
                                rows={12}
                            />
                            <CheckToggle
                                label="Allow clients to toggle light/dark theme in portal"
                                checked={allowClientThemeToggle}
                                onChange={setAllowClientThemeToggle}
                            />
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">
                                    Images are served from the backend’s <code className="font-mono">/static/uploads</code>.
                                </p>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={onResetPreview}>Reset Preview</Button>
                                    <Button variant="success" onClick={onSave}>Save Branding</Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </CardContent>
            </Card>
        </TabsContent>
    );
}

--- FILE: remoteiq-frontend/lib/api.ts ---

// Centralized typed API client used by the frontend (Next.js / React).
// It reads NEXT_PUBLIC_API_BASE for the backend base URL.

// ---------------------------- ENV / BASE ------------------------------------
const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "";

// Utility to join base + path safely
function url(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonInit = Omit<RequestInit, "body" | "method"> & {
  body?: any;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

// unified fetch wrapper w/ JSON
export async function jfetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const { body, ...rest } = init;
  const res = await fetch(url(path), {
    method: init.method ?? (body != null ? "POST" : "GET"),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (!res.ok) {
    // try to surface JSON message; fall back to text
    let msg = "";
    try {
      const data = await res.json();
      msg = typeof (data as any)?.message === "string" ? (data as any).message : JSON.stringify(data);
    } catch {
      try {
        msg = await res.text();
      } catch {
        // ignore
      }
    }
    const err = new Error(msg || `Request failed: ${res.status}`);
    (err as any).status = res.status; // preserve status for caller fallbacks
    throw err;
  }

  if (res.status === 204) return undefined as unknown as T;
  try {
    return (await res.json()) as T;
  } catch {
    // when backend returns 200 with empty body
    return undefined as unknown as T;
  }
}

// ---------------------------------------------------------------------------
// Devices (grid + details)
// ---------------------------------------------------------------------------
// lib/api.ts  (only showing the Device type block; keep the rest as-is)
export type Device = {
  id: string;
  hostname: string;
  os: string;
  arch?: string | null;
  lastSeen?: string | null;
  status: "online" | "offline";
  client?: string | null;
  site?: string | null;
  user?: string | string[] | null;
  version?: string | null;      // <-- add
  primaryIp?: string | null;    // <-- add
  /** Optional UUID for the underlying agent (if backend provides it). */
  agentUuid?: string | null;    // <-- NEW (harmless if absent)
};

export type DevicesResponse = {
  items: Device[];
  nextCursor: string | null;
};

export type DeviceFilters = {
  q?: string;
  status?: "online" | "offline";
  os?: string[];
};

export async function fetchDevices(
  pageSize = 25,
  cursor: string | null = null,
  filters?: DeviceFilters
): Promise<DevicesResponse> {
  const sp = new URLSearchParams();
  sp.set("pageSize", String(pageSize));
  if (cursor) sp.set("cursor", cursor);
  if (filters?.q) sp.set("q", filters.q);
  if (filters?.status) sp.set("status", filters.status);
  (filters?.os ?? []).forEach((o) => sp.append("os", o));
  return await jfetch<DevicesResponse>(`/api/devices?${sp.toString()}`);
}

export async function fetchDevice(id: string): Promise<Device> {
  return await jfetch<Device>(`/api/devices/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Device insights (checks / software)
// ---------------------------------------------------------------------------
export type DeviceCheck = {
  id: string;
  name: string;
  status: "Passing" | "Warning" | "Failing";
  lastRun: string;
  output: string;

  // ----- Optional advanced fields (rendered when present) -----
  /** e.g., "PING","CPU","MEMORY","DISK","SERVICE","PROCESS","PORT","WINEVENT","SOFTWARE","SECURITY","SCRIPT","PATCH","CERT","SMART","RDP","SMB","FIREWALL" */
  type?: string;
  /** severity classification applied to alerting paths */
  severity?: "WARN" | "CRIT";
  /** optional grouping like "Performance", "Security", "Compliance" */
  category?: string;
  /** arbitrary labels */
  tags?: string[];
  /** thresholds used to evaluate this check (key/value) */
  thresholds?: Record<string, any>;
  /** metrics captured by the last run (key/value) */
  metrics?: Record<string, number | string | boolean>;
  /** true if within an active maintenance window */
  maintenance?: boolean;
  /** deduplication key for alert correlation */
  dedupeKey?: string;
};

/** Fetch device-scoped checks; limit is optional and passed to the backend if provided. */
export async function fetchDeviceChecks(
  deviceId: string,
  limit?: number
): Promise<{ items: DeviceCheck[] }> {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/checks`;
  const path = typeof limit === "number" ? `${base}?limit=${encodeURIComponent(String(limit))}` : base;
  return await jfetch(path);
}

export type DeviceSoftware = {
  id: string;
  name: string;
  version: string;
  publisher?: string | null;
  installDate?: string | null;
};

export async function fetchDeviceSoftware(deviceId: string): Promise<{ items: DeviceSoftware[] }> {
  return await jfetch(`/api/devices/${encodeURIComponent(deviceId)}/software`);
}

// ---------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------
export async function rebootDevice(id: string): Promise<{ accepted: true; jobId: string }> {
  return await jfetch(`/api/devices/${encodeURIComponent(id)}/actions/reboot`, { method: "POST" });
}
export async function patchDevice(id: string): Promise<{ accepted: true; jobId: string }> {
  return await jfetch(`/api/devices/${encodeURIComponent(id)}/actions/patch`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Automation / Runs
// ---------------------------------------------------------------------------
export type RunScriptRequest = {
  deviceId: string;
  script: string;
  shell?: "powershell" | "bash" | "cmd";
  timeoutSec?: number;
};

export async function postRunScript(req: RunScriptRequest): Promise<{ jobId: string }> {
  return await jfetch(`/api/automation/runs`, { method: "POST", body: req });
}

export type JobSnapshot = {
  jobId: string;
  deviceId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  log: string;
  exitCode?: number | null;
  startedAt: number;
  finishedAt?: number | null;
};

export async function fetchJob(jobId: string): Promise<JobSnapshot> {
  return await jfetch(`/api/automation/runs/${encodeURIComponent(jobId)}`);
}
export async function fetchJobLog(jobId: string): Promise<{ jobId: string; log: string }> {
  return await jfetch(`/api/automation/runs/${encodeURIComponent(jobId)}/log`);
}

// ---------------------------------------------------------------------------
// Admin → Database configuration
// ---------------------------------------------------------------------------
export type DbEngine = "postgresql" | "mysql" | "mssql" | "sqlite" | "mongodb";
export type DbAuthMode = "fields" | "url";
export type StorageDomain =
  | "users" | "roles" | "sessions" | "audit_logs" | "devices" | "policies" | "email_queue";

export type DatabaseMappings = Record<StorageDomain, string>;

export type DatabaseConfig = {
  enabled: boolean;
  engine: DbEngine;
  authMode: DbAuthMode;
  url?: string;
  host?: string;
  port?: number;
  dbName?: string;
  username?: string;
  password?: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
  readReplicas?: string;
  mappings: DatabaseMappings;
};

export type DbTestResult = {
  ok: boolean;
  engine: DbEngine;
  primary: { ok: boolean; message?: string };
  replicas?: Array<{ url: string; ok: boolean; message?: string }>;
  note?: string;
};

export async function getDatabaseConfig(): Promise<DatabaseConfig | { enabled: false }> {
  return await jfetch(`/api/admin/database`);
}

export async function testDatabaseConfig(cfg: DatabaseConfig): Promise<DbTestResult> {
  return await jfetch(`/api/admin/database/test`, { method: "POST", body: cfg });
}

export async function saveDatabaseConfig(cfg: DatabaseConfig): Promise<void> {
  await jfetch<void>(`/api/admin/database/save`, { method: "POST", body: cfg });
}

export async function dryRunDatabaseMigration(): Promise<{ ok: true; destructive: false; steps: string[] }> {
  return await jfetch(`/api/admin/database/migrate/dry-run`, { method: "POST" });
}

// --- Company profile (admin) ---
export type CompanyProfile = {
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  fax?: string;
  website?: string;
  vatTin?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
};

export async function getCompanyProfile(): Promise<CompanyProfile> {
  return await jfetch(`/api/admin/company`);
}

export async function saveCompanyProfile(p: CompanyProfile): Promise<void> {
  await jfetch(`/api/admin/company/save`, { method: "POST", body: p });
}

// --- Localization (admin) ---
export type LocalizationSettings = {
  language: string;                // "en-US"
  dateFormat: string;              // "MM/DD/YYYY"
  timeFormat: "12h" | "24h";       // strictly 12h/24h for UI consistency
  numberFormat: string;            // "1,234.56"
  timeZone: string;                // "America/New_York"
  firstDayOfWeek: "sunday" | "monday";
  currency?: string;               // "USD"
};

export async function getLocalizationSettings(): Promise<LocalizationSettings> {
  const res = await jfetch<LocalizationSettings | { exists: false }>(`/api/admin/localization`);
  if ((res as any)?.exists === false) {
    return {
      language: "en-US",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      numberFormat: "1,234.56",
      timeZone: "America/New_York",
      firstDayOfWeek: "sunday",
      currency: "USD",
    };
  }
  // Back-compat: normalize any legacy strings to the union
  const tfRaw = (res as any).timeFormat as string | undefined;
  const timeFormat: "12h" | "24h" = tfRaw === "24h" || tfRaw === "HH:mm" ? "24h" : "12h";
  return { ...(res as LocalizationSettings), timeFormat };
}

export async function saveLocalizationSettings(p: LocalizationSettings): Promise<void> {
  await jfetch(`/api/admin/localization/save`, { method: "POST", body: p });
}

// --- Support & Legal (admin) ---
export type SupportLegalSettings = {
  id?: number;                 // present on GET only
  supportEmail?: string;
  supportPhone?: string;
  knowledgeBaseUrl?: string;
  statusPageUrl?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  gdprContactEmail?: string;
  legalAddress?: string;
  ticketPortalUrl?: string;
  phoneHours?: string;
  notesHtml?: string;
};

export async function getSupportLegalSettings(): Promise<SupportLegalSettings> {
  return await jfetch(`/api/admin/support-legal`);
}

export async function saveSupportLegalSettings(
  p: Omit<SupportLegalSettings, "id">
): Promise<void> {
  await jfetch(`/api/admin/support-legal/save`, { method: "POST", body: p });
}

// ======================= Users & Roles (Admin) =======================
export type RoleDTO = { id: string; name: string };
export type UserDTO = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId?: string | null;
  roles?: Array<{ id: string; name: string }>;
  twoFactorEnabled: boolean;
  suspended: boolean;
  lastSeen: string | null;
  status: "active" | "invited" | "suspended";
  createdAt?: string;
  updatedAt?: string;

  // Optional profile fields (present if your DB exposes them)
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
};

export async function getAdminRoles(): Promise<{ items: RoleDTO[] }> {
  // Wrap server response (array) into {items} for consistency
  const arr = await jfetch<RoleDTO[]>(`/api/admin/users/roles`);
  return { items: arr };
}

export async function getAdminUsers(): Promise<{ items: UserDTO[]; total?: number }> {
  // backend returns {items, total}
  return await jfetch(`/api/admin/users`);
}

export type InvitePayload = { name?: string; email: string; role?: string; message?: string };

/** Invite one-by-one under the hood to keep types simple */
export async function inviteUsers(invites: InvitePayload[]): Promise<{ created: UserDTO[] }> {
  const created: UserDTO[] = [];
  for (const i of invites) {
    const resp = await jfetch<{ id: string }>(`/api/admin/users/invite`, {
      method: "POST",
      body: i,
    });
    const roleValue = typeof i.role === "string" ? i.role.trim() : "";
    const roleIsUuid = roleValue && UUID_REGEX.test(roleValue);
    created.push({
      id: resp.id,
      name: i.name ?? i.email.split("@")[0],
      email: i.email,
      role: roleIsUuid ? "" : roleValue || "",
      roleId: roleIsUuid ? roleValue : undefined,
      status: "invited",
      twoFactorEnabled: false,
      suspended: false,
      lastSeen: null,
    });
  }
  return { created };
}

/** Change a user's role */
export async function updateUserRole(userId: string, role: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: { role },
  });
}

/** Trigger a 2FA reset */
export async function resetUser2FA(userId: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/reset-2fa`, {
    method: "POST",
  });
}

/** Remove (delete) a user */
export async function removeUser(userId: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

/** Suspend / Unsuspend user */
export async function setUserSuspended(userId: string, suspended: boolean): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: "POST",
    body: { suspended },
  });
}

/* -------- Admin create + reset password -------- */
export type CreateUserPayload = {
  name: string;
  email: string;
  role?: string;
  password: string;
  status?: "active" | "invited" | "suspended";
};

export async function createAdminUser(p: CreateUserPayload): Promise<{ id: string }> {
  return await jfetch(`/api/admin/users/create`, { method: "POST", body: p });
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  await jfetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: { password },
  });
}

/* -------- NEW: Update user details (partial) -------- */
export type UpdateUserPayload = Partial<{
  name: string;
  email: string;
  role: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}>;

export async function updateUser(userId: string, p: UpdateUserPayload): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: p,
  });
}

// ---------------------------------------------------------------------------
// Account (current user) - Profile
// ---------------------------------------------------------------------------
export type MeProfile = {
  id: string;
  name: string;
  email: string;
  username?: string;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  avatarUrl?: string | null; // backend may store as avatar_url; mapped server-side
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateMePayload = Partial<{
  name: string;
  email: string;
  username: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
  timezone: string | null;
  locale: string | null;
  avatarUrl: string | null;
}>;

/** Load the signed-in user's profile */
export async function getMyProfile(): Promise<MeProfile> {
  return await jfetch<MeProfile>(`/api/users/me`);
}

/** Patch the signed-in user's profile (only sends provided keys) */
export async function updateMyProfile(patch: UpdateMePayload): Promise<MeProfile> {
  const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return await jfetch<MeProfile>(`/api/users/me`, { method: "PATCH", body });
}

// ---------------------------------------------------------------------------
// Account (current user) - Security & Sessions (legacy helpers kept)
// ---------------------------------------------------------------------------
export type SecuritySettings = {
  twoFaEnabled: boolean;
  autoRevokeSessions?: boolean;
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
  return await jfetch(`/api/users/security`);
}
export async function saveSecuritySettings(p: Partial<SecuritySettings>): Promise<void> {
  await jfetch(`/api/users/security`, { method: "PATCH", body: p });
}

export type SessionDTO = {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
  current: boolean;
  city?: string;
  isp?: string;
  trusted?: boolean;
};

export async function listSessions(): Promise<{ items: SessionDTO[] }> {
  return await jfetch(`/api/users/sessions`);
}
export async function toggleTrustSession(sessionId: string, trusted: boolean): Promise<void> {
  await jfetch(`/api/users/sessions/${encodeURIComponent(sessionId)}/trust`, {
    method: "POST",
    body: { trusted },
  });
}
export async function revokeSession(sessionId: string): Promise<void> {
  await jfetch(`/api/users/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
export async function revokeAllSessions(): Promise<void> {
  await jfetch(`/api/users/sessions`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Account (current user) - Notifications
// ---------------------------------------------------------------------------
export type NotificationSettings = {
  email: boolean;
  push: boolean;
  product: boolean;
  digest: "off" | "daily" | "weekly";
  quiet?: { enabled: boolean; start?: string; end?: string };
  products?: string[];
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return await jfetch(`/api/users/notifications`);
}
export async function saveNotificationSettings(p: Partial<NotificationSettings>): Promise<void> {
  await jfetch(`/api/users/notifications`, { method: "PATCH", body: p });
}

// ---------------------------------------------------------------------------
// Account (current user) - Integrations (Slack + generic webhook)
// ---------------------------------------------------------------------------
export type IntegrationsSettings = {
  slackWebhook?: string;
  webhookUrl?: string;
  webhookSigningSecret?: string;
  events?: string[];
};

export async function getIntegrationsSettings(): Promise<IntegrationsSettings> {
  return await jfetch(`/api/users/integrations`);
}
export async function saveIntegrationsSettings(p: Partial<IntegrationsSettings>): Promise<void> {
  await jfetch(`/api/users/integrations`, { method: "PATCH", body: p });
}

export async function testSlackWebhook(urlStr: string): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/slack`, { method: "POST", body: { url: urlStr } });
}
export async function testGenericWebhook(urlStr: string): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/webhook`, { method: "POST", body: { url: urlStr } });
}
export async function rotateSigningSecret(): Promise<{ secret: string }> {
  return await jfetch(`/api/users/integrations/rotate-signing-secret`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Account (current user) - API Keys
// ---------------------------------------------------------------------------
export type ApiKeyDTO = {
  id: string;          // token id (e.g., "rk_live_xxx")
  label: string;
  lastUsed?: string;
  scopes?: string[];
  expiresAt?: string;  // iso or empty string if never
};

export async function listApiKeys(): Promise<{ items: ApiKeyDTO[] }> {
  const arr = await jfetch<ApiKeyDTO[]>(`/api/users/api-keys`);
  return { items: arr };
}

export async function createApiKey(
  label: string,
  scopes: string[],
  expiresIn: "never" | "30d" | "90d",
  ipAllowlist?: string
): Promise<ApiKeyDTO> {
  return await jfetch(`/api/users/api-keys`, {
    method: "POST",
    body: { label, scopes, expiresIn, ipAllowlist },
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await jfetch(`/api/users/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function regenerateApiKey(id: string): Promise<{ oldId: string; newKey: string }> {
  return await jfetch(`/api/users/api-keys/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
}

// Upload avatar to the dedicated endpoint
export async function uploadMyAvatar(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file, file.name || "avatar.png");

  const base = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "";
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/users/me/avatar`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json())?.message || ""; } catch { }
    if (!msg) try { msg = await res.text(); } catch { }
    throw new Error(msg || `Upload failed (${res.status})`);
  }
  return (await res.json()) as { url: string };
}

export async function removeMyAvatar(): Promise<void> {
  await jfetch<void>(`/api/users/me/avatar`, { method: "DELETE" });
}

/* ============================================================================
   NEW: Security Overview + TOTP + Sessions (ME scope) + PAT + WebAuthn stubs
   ==========================================================================*/

// ---- Types used by the Security tab ----
export type SecurityEvent = {
  id: string;
  type:
  | "signed_in"
  | "password_changed"
  | "2fa_enabled"
  | "2fa_disabled"
  | "recovery_codes_regenerated"
  | "session_revoked";
  at: string;
  ip?: string;
  userAgent?: string;
};

export type WebAuthnCredential = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type RecoveryCodes = string[];

// ---- Sessions (ME) ----
export type Session = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  trusted?: boolean;
  label?: string | null;
  revokedAt?: string | null; // <-- include so we can filter locally
};

export type SecurityOverview = {
  twoFactorEnabled: boolean;
  sessions: Session[];
  events: SecurityEvent[];
  webAuthn?: WebAuthnCredential[];
};

export type TOTPInit = { secret: string; otpauthUrl: string; qrPngDataUrl: string };

// ---- Overview ----
export async function getSecurityOverview(): Promise<SecurityOverview> {
  return await jfetch<SecurityOverview>(`/api/users/me/security`);
}

// ---- Change Password ----
export async function changePasswordSelf(current: string, next: string): Promise<void> {
  await jfetch(`/api/users/me/password`, { method: "POST", body: { current, next } });
}

// ---- TOTP 2FA ----
export async function start2FA(): Promise<TOTPInit> {
  return await jfetch<TOTPInit>(`/api/users/me/2fa/start`, { method: "POST" });
}

export async function confirm2FA(p: { code: string }): Promise<void> {
  await jfetch(`/api/users/me/2fa/confirm`, { method: "POST", body: p });
}

export async function disable2FA(p?: { code?: string; recoveryCode?: string }): Promise<void> {
  await jfetch(`/api/users/me/2fa/disable`, { method: "POST", body: p ?? {} });
}

export async function regenerateRecoveryCodes(): Promise<RecoveryCodes> {
  const res = await jfetch<{ recoveryCodes: string[] }>(`/api/users/me/2fa/recovery/regen`, {
    method: "POST",
  });
  return res.recoveryCodes;
}

// ---- Sessions (ME) ----
// NOTE: some servers include revoked sessions in the list; we filter them out.
export async function listMySessions(): Promise<{ items: Session[]; currentJti?: string }> {
  const res = await jfetch<{ items: Session[]; currentJti?: string }>(`/api/users/me/sessions/`);
  const items = (res.items ?? []).filter((s) => !s.revokedAt); // <-- hide revoked
  return { items, currentJti: res.currentJti };
}

export async function revokeAllOtherSessions(): Promise<void> {
  await jfetch(`/api/users/me/sessions/revoke-all`, { method: "POST" });
}

/**
 * Revoke a single session (ME).
 * Tries a sequence of plausible endpoints so we work with whatever the backend exposes.
 */
export async function revokeMySession(sessionId: string): Promise<void> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  // 1) Preferred: DELETE /me/sessions/:id
  try {
    await jfetch(base, { method: "DELETE" });
    return;
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405 || msg.includes("cannot delete"))) throw e;
  }

  // 2) Alt: POST /me/sessions/:id/revoke
  try {
    await jfetch(`${base}/revoke`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 3) Alt: POST /me/sessions/revoke  { sessionId }
  try {
    await jfetch(`/api/users/me/sessions/revoke`, { method: "POST", body: { sessionId } });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 4) Alt: POST /me/sessions/revoke/:id
  try {
    await jfetch(`/api/users/me/sessions/revoke/${enc}`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 5) Last-resort: PATCH /me/sessions/:id { action: "revoke" }
  await jfetch(base, { method: "PATCH", body: { action: "revoke" } });
}

/** Trust / untrust a session (ME) with fallbacks similar to revoke */
export async function trustMySession(
  sessionId: string,
  trusted: boolean
): Promise<{ trusted: boolean }> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  // 1) Preferred: POST /me/sessions/:id/trust { trusted }
  try {
    return await jfetch(`${base}/trust`, { method: "POST", body: { trusted } });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 2) Alt: POST /me/sessions/trust { sessionId, trusted }
  try {
    return await jfetch(`/api/users/me/sessions/trust`, {
      method: "POST",
      body: { sessionId, trusted },
    });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 3) Last-resort: PATCH /me/sessions/:id { trusted }
  return await jfetch(base, { method: "PATCH", body: { trusted } });
}

/** Optional: label a session (ME) */
export async function labelMySession(sessionId: string, label: string): Promise<void> {
  await jfetch(`/api/users/me/sessions/${encodeURIComponent(sessionId)}/label`, {
    method: "POST",
    body: { label },
  });
}

// lib/api.ts → mapMeSessionToDTO
export function mapMeSessionToDTO(s: Session): SessionDTO {
  return {
    id: s.id,
    device: s.label || s.userAgent || "Unknown device",
    ip: s.ip ?? "",                 // string (never undefined)
    lastActive: s.lastSeenAt ?? "", // string (never undefined)
    current: !!s.current,           // boolean
    city: undefined,
    isp: undefined,
    trusted: s.trusted ?? false,
  };
}


// ---- Personal Tokens (ME) ----
export type PersonalToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export async function listMyTokens(): Promise<{ items: PersonalToken[] }> {
  return await jfetch(`/api/users/me/tokens`);
}

export async function createMyToken(name: string): Promise<{ token: string; id: string }> {
  return await jfetch(`/api/users/me/tokens`, { method: "POST", body: { name } });
}

export async function revokeMyToken(id: string): Promise<void> {
  await jfetch(`/api/users/me/tokens/revoke`, { method: "POST", body: { id } });
}

// ---- WebAuthn (optional / stubbed) ----
export async function webauthnCreateOptions(): Promise<PublicKeyCredentialCreationOptions> {
  return await jfetch(`/api/users/me/webauthn/create-options`);
}

export async function webauthnFinishRegistration(attestationResponse: any): Promise<WebAuthnCredential> {
  return await jfetch(`/api/users/me/webauthn/finish`, { method: "POST", body: attestationResponse });
}

export async function deleteWebAuthnCredential(id: string): Promise<void> {
  return await jfetch(`/api/users/me/webauthn/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Device software: request uninstall --------------------------------
export async function requestUninstallSoftware(
  deviceId: string,
  body: { name: string; version?: string }
): Promise<{ accepted: true; jobId?: string }> {
  const res = await fetch(
    `${((typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "").replace(/\/+$/, "")}/api/devices/${encodeURIComponent(deviceId)}/actions/uninstall`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    // surface error text
    let msg = "";
    try { msg = (await res.clone().json())?.message || ""; } catch { }
    if (!msg) try { msg = await res.text(); } catch { }
    throw new Error(msg || `Request failed: ${res.status}`);
  }

  // Try JSON first
  let jobId: string | undefined;
  try {
    const json = await res.clone().json();
    jobId = json?.jobId;
  } catch {
    /* no json body */
  }

  // Fallback: parse Location header (e.g. /api/automation/runs/<uuid>)
  if (!jobId) {
    const loc = res.headers.get("Location") || res.headers.get("location");
    const m = loc?.match(/([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12})$/);
    if (m) jobId = m[1];
  }

  return { accepted: true, jobId };
}

