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
