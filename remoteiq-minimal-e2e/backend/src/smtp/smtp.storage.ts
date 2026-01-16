// backend/src/smtp/smtp.storage.ts
import { promises as fs } from "fs";
import { dirname, join } from "path";

export type EmailPurpose = "alerts" | "invites" | "password_resets" | "reports";

export type SmtpSettings = {
    host: string;
    port?: number;
    username: string;
    password?: string;
    useTLS: boolean;
    useSSL: boolean;
    fromAddress: string;
};
export type ImapSettings = {
    host: string;
    port?: number;
    username: string;
    password?: string;
    useSSL: boolean;
};
export type PopSettings = {
    host: string;
    port?: number;
    username: string;
    password?: string;
    useSSL: boolean;
};
export type EmailProfile = {
    smtp: SmtpSettings;
    imap: ImapSettings;
    pop: PopSettings;
    enabled: boolean;
};

export type EmailConfigOnDisk = {
    profiles: Record<EmailPurpose, EmailProfile>;
    lastUpdated?: string;
};

const DEFAULT_PROFILE: EmailProfile = {
    enabled: true,
    smtp: {
        host: "",
        port: 587,
        username: "",
        password: undefined,
        useTLS: true,
        useSSL: false,
        fromAddress: "",
    },
    imap: { host: "", port: 993, username: "", password: undefined, useSSL: true },
    pop: { host: "", port: 995, username: "", password: undefined, useSSL: true },
};

const DEFAULTS: EmailConfigOnDisk = {
    profiles: {
        alerts: { ...DEFAULT_PROFILE },
        invites: { ...DEFAULT_PROFILE },
        password_resets: { ...DEFAULT_PROFILE },
        reports: { ...DEFAULT_PROFILE },
    },
    lastUpdated: undefined,
};

export class SmtpStorage {
    private file: string;
    constructor(baseDir = process.env.ADMIN_DATA_DIR || join(process.cwd(), "var")) {
        this.file = join(baseDir, "email-settings.json");
    }

    async load(): Promise<EmailConfigOnDisk> {
        try {
            const raw = await fs.readFile(this.file, "utf8");
            const parsed = JSON.parse(typeof raw === "string" ? raw : ((raw as any).toString("utf8")));
            return {
                ...DEFAULTS,
                ...parsed,
                profiles: { ...DEFAULTS.profiles, ...(parsed.profiles || {}) },
            };
        } catch {
            await this.ensureDir();
            await this.save(DEFAULTS);
            return DEFAULTS;
        }
    }

    async save(cfg: EmailConfigOnDisk): Promise<void> {
        await this.ensureDir();
        const withStamp = {
            ...cfg,
            lastUpdated: cfg.lastUpdated ?? new Date().toISOString(),
        };
        await fs.writeFile(this.file, JSON.stringify(withStamp, null, 2), "utf8");
    }

    private async ensureDir() {
        await fs.mkdir(dirname(this.file), { recursive: true });
    }

    /** Remove secrets before returning to clients. */
    maskPasswords<T extends EmailConfigOnDisk>(cfg: T): T {
        const clone = JSON.parse(JSON.stringify(cfg)) as T;
        for (const k of Object.keys((clone as any).profiles || {})) {
            const p = (clone as any).profiles[k];
            if (p?.smtp) delete p.smtp.password;
            if (p?.imap) delete p.imap.password;
            if (p?.pop) delete p.pop.password;
        }
        return clone;
    }
}
