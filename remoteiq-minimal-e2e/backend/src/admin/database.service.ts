// backend/src/admin/database.service.ts
import { Injectable } from "@nestjs/common";
import { DatabaseConfigDto, TestResultDto, DbEngine } from "./database.dto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const CONFIG_PATH = path.join(CONFIG_DIR, "database.json");

// Redact helpers
const redact = (s?: string | null) => (s ? "****" : s);

@Injectable()
export class DatabaseService {
    private current: DatabaseConfigDto | null = null;

    async loadConfig(): Promise<DatabaseConfigDto | null> {
        try {
            const raw = await fs.readFile(CONFIG_PATH, "utf-8");
            this.current = JSON.parse(typeof raw === "string" ? raw : ((raw as any).toString("utf8")));
            return this.current;
        } catch {
            return null;
        }
    }

    async saveConfig(cfg: DatabaseConfigDto): Promise<void> {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
        this.current = cfg;
    }

    getConfig(): DatabaseConfigDto | null {
        return this.current;
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
            case "postgresql": return 5432;
            case "mysql": return 3306;
            case "mssql": return 1433;
            case "mongodb": return 27017;
            case "sqlite": return 0;
        }
        // satisfy TS: all paths return
        return 0;
    }

    parseReplicas(csv?: string): string[] {
        return (csv || "")
            .split(",")
            .map(s => s.trim())
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
            (result.replicas ? result.replicas.every(r => r.ok) : true);

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
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const { Client } = (await import("pg")) as any;
                    const client = new Client({ connectionString: url || undefined, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined });
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
                        const db = new bsql.default((cfg.dbName || "remoteiq.sqlite"), { fileMustExist: false });
                        db.prepare("CREATE TABLE IF NOT EXISTS _ping (id INTEGER)").run();
                        db.prepare("SELECT 1").get();
                        db.close();
                        return { ok: true };
                    } catch {
                        // fallback to sqlite3/sqlite
                        try {
                            const sqlite3 = (await import("sqlite3")) as any;
                            const { open } = (await import("sqlite")) as any;
                            const db = await open({ filename: (cfg.dbName || "remoteiq.sqlite"), driver: sqlite3.Database });
                            await db.exec("CREATE TABLE IF NOT EXISTS _ping (id INTEGER)");
                            await db.close();
                            return { ok: true };
                        } catch (e2: any) {
                            return { ok: false, message: `Install 'better-sqlite3' OR 'sqlite3' + 'sqlite': ${e2?.message || e2}` };
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
