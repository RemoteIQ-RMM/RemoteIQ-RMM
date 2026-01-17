// backend/src/admin/database.service.ts
import { Injectable } from "@nestjs/common";
import { DatabaseConfigDto, TestResultDto, DbEngine } from "./database.dto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const CONFIG_PATH = path.join(CONFIG_DIR, "database.json");

// Our mask token for UI round-trips
const MASK = "****";

function stripCredsFromUrl(url: string): string {
    // Try URL parser first (supports custom schemes)
    try {
        const u = new URL(url);
        if (u.password) u.password = ""; // removes secret
        // keep username; remove ":"
        // URL will serialize userinfo as "user:@host" if password empty; we want "user@host"
        // Quick normalize:
        const s = u.toString();
        return s.replace(/:\/\/([^:@\/?#]+):@/i, "://$1@");
    } catch {
        // Fallback: replace password between ":" and "@"
        // e.g. postgres://user:pass@host -> postgres://user:****@host
        return url.replace(/:\/\/([^:@\/?#]+):([^@\/?#]+)@/i, (_m, user) => `://${user}:${MASK}@`);
    }
}

function looksMaskedUrl(url: string): boolean {
    // If UI sends back a masked URL, preserve the existing secret URL.
    return (
        url.includes(`:${MASK}@`) ||
        url.includes(`=${MASK}`) ||
        url.includes(MASK)
    );
}

@Injectable()
export class DatabaseService {
    private current: DatabaseConfigDto | null = null;

    async loadConfig(): Promise<DatabaseConfigDto | null> {
        try {
            const raw = await fs.readFile(CONFIG_PATH, "utf-8");
            this.current = JSON.parse(
                typeof raw === "string" ? raw : (raw as any).toString("utf8")
            );
            return this.current;
        } catch {
            return null;
        }
    }

    /**
     * Save config while preserving existing secrets unless explicitly changed.
     *
     * Rules:
     * - If authMode=url and url is missing/empty OR looks masked -> keep existing url
     * - If fields-mode and password is undefined/null -> keep existing password
     * - If password is "" (empty string) -> allow clearing (explicit)
     */
    async saveConfig(incoming: DatabaseConfigDto): Promise<void> {
        const existing = this.current ?? (await this.loadConfig());
        const merged: DatabaseConfigDto = { ...(existing as any), ...(incoming as any) };

        if (merged.authMode === "url") {
            const nextUrl = (incoming as any)?.url;
            const prevUrl = (existing as any)?.url;

            if (!nextUrl || String(nextUrl).trim() === "") {
                merged.url = prevUrl ?? merged.url ?? "";
            } else if (looksMaskedUrl(String(nextUrl)) && prevUrl) {
                merged.url = prevUrl;
            } else {
                merged.url = String(nextUrl);
            }

            // In url mode, field passwords are irrelevant; keep but don't rely on them.
            // (no-op)
        } else {
            // fields mode
            const nextPass = (incoming as any)?.password;
            const prevPass = (existing as any)?.password;

            // Only preserve if undefined/null; empty string means "clear it"
            if ((nextPass === undefined || nextPass === null) && prevPass !== undefined) {
                merged.password = prevPass;
            }
        }

        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
        this.current = merged;
    }

    getConfig(): DatabaseConfigDto | null {
        return this.current;
    }

    /**
     * IMPORTANT: sanitize secrets out of the config before returning to clients.
     */
    sanitizeForClient(cfg: DatabaseConfigDto): DatabaseConfigDto {
        const out: DatabaseConfigDto = JSON.parse(JSON.stringify(cfg));

        // Never return raw password
        if ((out as any).password !== undefined) {
            (out as any).password = undefined;
        }

        // Never return credentialed URL
        if (out.authMode === "url" && out.url) {
            out.url = stripCredsFromUrl(out.url);
        }

        return out;
    }

    // Build a connection URL from "fields" mode if needed
    buildUrl(cfg: DatabaseConfigDto): string | null {
        if (cfg.authMode === "url") return cfg.url || null;
        const host = cfg.host ?? "localhost";
        const port = cfg.port ?? this.defaultPort(cfg.engine);
        const db = cfg.dbName ?? "";
        const user = cfg.username ?? "";
        const pass = cfg.password ? encodeURIComponent(cfg.password) : "";
        switch (cfg.engine) {
            case "postgresql":
                return user
                    ? `postgres://${user}:${pass}@${host}:${port}/${db}${cfg.ssl ? "?sslmode=require" : ""}`
                    : `postgres://${host}:${port}/${db}${cfg.ssl ? "?sslmode=require" : ""}`;
            case "mysql":
                return user
                    ? `mysql://${user}:${pass}@${host}:${port}/${db}`
                    : `mysql://${host}:${port}/${db}`;
            case "mssql":
                return user
                    ? `mssql://${user}:${pass}@${host}:${port}/${db}`
                    : `mssql://${host}:${port}/${db}`;
            case "sqlite":
                // dbName serves as filepath
                return `file:${db || "remoteiq.sqlite"}?mode=rwc`;
            case "mongodb":
                return user
                    ? `mongodb://${user}:${pass}@${host}:${port}/${db}${cfg.ssl ? "?tls=true" : ""}`
                    : `mongodb://${host}:${port}/${db}${cfg.ssl ? "?tls=true" : ""}`;
            default:
                return null;
        }
    }

    defaultPort(engine: DbEngine): number {
        switch (engine) {
            case "postgresql":
                return 5432;
            case "mysql":
                return 3306;
            case "mssql":
                return 1433;
            case "mongodb":
                return 27017;
            case "sqlite":
                return 0;
        }
        return 0;
    }

    parseReplicas(csv?: string): string[] {
        return (csv || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    /**
     * Attempt real connection(s). Drivers are loaded dynamically, so you only
     * need to install the one(s) you actually use.
     */
    async testConnection(cfg: DatabaseConfigDto): Promise<TestResultDto> {
        const url = this.buildUrl(cfg);
        const replicas = this.parseReplicas(cfg.readReplicas);
        const result: TestResultDto = {
            ok: false,
            engine: cfg.engine,
            primary: { ok: false },
            replicas: replicas.length ? [] : undefined,
            note: "Drivers are loaded dynamically; install only what you use.",
        };

        // Primary
        result.primary = await this.tryConnect(cfg.engine, url, cfg);

        // Replicas
        for (const ru of replicas) {
            const r = await this.tryConnect(cfg.engine, ru, cfg);
            result.replicas!.push({ url: ru, ok: r.ok, message: r.message });
        }

        result.ok =
            result.primary.ok &&
            (result.replicas ? result.replicas.every((r) => r.ok) : true);

        return result;
    }

    private async tryConnect(
        engine: DbEngine,
        url: string | null,
        cfg: DatabaseConfigDto
    ): Promise<{ ok: boolean; message?: string }> {
        try {
            switch (engine) {
                case "postgresql": {
                    const { Client } = (await import("pg")) as any;
                    const client = new Client({
                        connectionString: url || undefined,
                        ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
                    });
                    await client.connect();
                    await client.query("SELECT 1");
                    await client.end();
                    return { ok: true };
                }
                case "mysql": {
                    const mysql = (await import("mysql2/promise")) as any;
                    const conn = await mysql.createConnection(url!);
                    await conn.query("SELECT 1");
                    await conn.end();
                    return { ok: true };
                }
                case "mssql": {
                    const mssql = (await import("mssql")) as any;
                    const pool = await mssql.connect(url!);
                    await pool.request().query("SELECT 1");
                    await pool.close();
                    return { ok: true };
                }
                case "sqlite": {
                    // Prefer better-sqlite3
                    try {
                        const bsql = (await import("better-sqlite3")) as any;
                        const db = new bsql.default(cfg.dbName || "remoteiq.sqlite", {
                            fileMustExist: false,
                        });
                        db.prepare("CREATE TABLE IF NOT EXISTS _ping (id INTEGER)").run();
                        db.prepare("SELECT 1").get();
                        db.close();
                        return { ok: true };
                    } catch {
                        // fallback to sqlite3/sqlite
                        try {
                            const sqlite3 = (await import("sqlite3")) as any;
                            const { open } = (await import("sqlite")) as any;
                            const db = await open({
                                filename: cfg.dbName || "remoteiq.sqlite",
                                driver: sqlite3.Database,
                            });
                            await db.exec("CREATE TABLE IF NOT EXISTS _ping (id INTEGER)");
                            await db.close();
                            return { ok: true };
                        } catch (e2: any) {
                            return {
                                ok: false,
                                message: `Install 'better-sqlite3' OR 'sqlite3' + 'sqlite': ${e2?.message || e2}`,
                            };
                        }
                    }
                }
                case "mongodb": {
                    const { MongoClient } = (await import("mongodb")) as any;
                    const client = new MongoClient(url!, { serverSelectionTimeoutMS: 4000 });
                    await client.connect();
                    await client.db().command({ ping: 1 });
                    await client.close();
                    return { ok: true };
                }
                default:
                    return { ok: false, message: "Unsupported engine" };
            }
        } catch (e: any) {
            return { ok: false, message: e?.message || String(e) };
        }
    }
}
