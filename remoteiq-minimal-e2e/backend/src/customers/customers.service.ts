// FILE: remoteiq-minimal-e2e/backend/src/customers/customers.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PgPoolService } from "../storage/pg-pool.service";

type ColumnMeta = {
  column_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

@Injectable()
export class CustomersService {
  constructor(private readonly db: PgPoolService) { }

  private tableExistsCache = new Map<string, boolean>();
  private columnExistsCache = new Map<string, boolean>();
  private columnsMetaCache = new Map<string, Record<string, ColumnMeta>>();

  private async tableExists(regclass: string): Promise<boolean> {
    const cached = this.tableExistsCache.get(regclass);
    if (typeof cached === "boolean") return cached;

    const { rows } = await this.db.query<{ exists: string | null }>(
      `SELECT to_regclass($1) AS exists`,
      [regclass]
    );

    const exists = !!rows?.[0]?.exists;
    this.tableExistsCache.set(regclass, exists);
    return exists;
  }

  private async columnExists(schema: string, table: string, column: string): Promise<boolean> {
    const key = `${schema}.${table}.${column}`;
    const cached = this.columnExistsCache.get(key);
    if (typeof cached === "boolean") return cached;

    const { rows } = await this.db.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1
      `,
      [schema, table, column]
    );

    const ok = rows.length > 0;
    this.columnExistsCache.set(key, ok);
    return ok;
  }

  private async getColumnsMeta(schema: string, table: string): Promise<Record<string, ColumnMeta>> {
    const key = `${schema}.${table}`;
    const cached = this.columnsMetaCache.get(key);
    if (cached) return cached;

    const { rows } = await this.db.query<ColumnMeta>(
      `
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      `,
      [schema, table]
    );

    const map: Record<string, ColumnMeta> = {};
    for (const r of rows) map[String(r.column_name)] = r;

    this.columnsMetaCache.set(key, map);
    return map;
  }

  private isUuid(input: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.trim()
    );
  }

  private parseLabels(raw: any): any {
    if (raw == null) return undefined;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return undefined;
      try {
        return JSON.parse(s);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async resolveClientId(
    clientParam: string,
    organizationId?: string | null
  ): Promise<string | null> {
    const raw = (clientParam ?? "").trim();
    if (!raw) return null;

    const hasClients = await this.tableExists("public.clients");
    if (!hasClients) return null;

    const clientsHasOrg =
      await this.columnExists("public", "clients", "organization_id");

    // If it's already a UUID, validate it exists (and matches org if applicable)
    if (this.isUuid(raw)) {
      const params: any[] = [raw];
      const where: string[] = [`c.id::text = $1`];

      if (clientsHasOrg && organizationId) {
        params.push(organizationId);
        where.push(`c.organization_id::text = $${params.length}`);
      }

      const { rows } = await this.db.query<{ id: string }>(
        `
        SELECT c.id::text AS id
        FROM public.clients c
        WHERE ${where.join(" AND ")}
        LIMIT 1
        `,
        params
      );
      return rows?.[0]?.id ?? null;
    }

    // Otherwise resolve by name
    const params: any[] = [raw];
    const where: string[] = [`lower(c.name) = lower($1)`];

    if (clientsHasOrg && organizationId) {
      params.push(organizationId);
      where.push(`c.organization_id::text = $${params.length}`);
    }

    const { rows } = await this.db.query<{ id: string }>(
      `
      SELECT c.id::text AS id
      FROM public.clients c
      WHERE ${where.join(" AND ")}
      ORDER BY c.id ASC
      LIMIT 1
      `,
      params
    );

    return rows?.[0]?.id ?? null;
  }

  private async resolveSiteIdForClient(
    clientId: string,
    siteParam: string,
    organizationId?: string | null
  ): Promise<string | null> {
    const raw = (siteParam ?? "").trim();
    if (!raw) return null;

    const hasSites = await this.tableExists("public.sites");
    if (!hasSites) return null;

    const sitesHasClientId = await this.columnExists("public", "sites", "client_id");
    if (!sitesHasClientId) return null;

    const sitesHasOrg = await this.columnExists("public", "sites", "organization_id");

    // UUID case: confirm belongs to client (+ org if applicable)
    if (this.isUuid(raw)) {
      const params: any[] = [raw, clientId];
      const where: string[] = [`s.id::text = $1`, `s.client_id::text = $2`];

      if (sitesHasOrg && organizationId) {
        params.push(organizationId);
        where.push(`s.organization_id::text = $${params.length}`);
      }

      const { rows } = await this.db.query<{ id: string }>(
        `
        SELECT s.id::text AS id
        FROM public.sites s
        WHERE ${where.join(" AND ")}
        LIMIT 1
        `,
        params
      );
      return rows?.[0]?.id ?? null;
    }

    // Name case: resolve within the client
    const params: any[] = [clientId, raw];
    const where: string[] = [`s.client_id::text = $1`, `lower(s.name) = lower($2)`];

    if (sitesHasOrg && organizationId) {
      params.push(organizationId);
      where.push(`s.organization_id::text = $${params.length}`);
    }

    const { rows } = await this.db.query<{ id: string }>(
      `
      SELECT s.id::text AS id
      FROM public.sites s
      WHERE ${where.join(" AND ")}
      ORDER BY s.id ASC
      LIMIT 1
      `,
      params
    );

    return rows?.[0]?.id ?? null;
  }

  /**
   * GET /api/customers?q=term
   */
  async listClients(q: string, organizationId?: string | null) {
    const term = (q ?? "").trim();

    const hasClients = await this.tableExists("public.clients");
    const hasSites = await this.tableExists("public.sites");
    const hasDevices = await this.tableExists("public.devices");
    const hasTickets = await this.tableExists("public.tickets");

    const clientsHasOrg =
      hasClients && (await this.columnExists("public", "clients", "organization_id"));

    const sitesHasClientId =
      hasSites && (await this.columnExists("public", "sites", "client_id"));

    const devicesHasClientId =
      hasDevices && (await this.columnExists("public", "devices", "client_id"));
    const devicesHasSiteId =
      hasDevices && (await this.columnExists("public", "devices", "site_id"));

    const ticketsHasClientId =
      hasTickets && (await this.columnExists("public", "tickets", "client_id"));
    const ticketsHasSiteId =
      hasTickets && (await this.columnExists("public", "tickets", "site_id"));
    const ticketsHasDeviceId =
      hasTickets && (await this.columnExists("public", "tickets", "device_id"));

    if (hasClients) {
      const params: any[] = [];
      const where: string[] = [];

      if (term) {
        params.push(`%${term}%`);
        where.push(`lower(c.name) LIKE lower($${params.length})`);
      }

      if (clientsHasOrg && organizationId) {
        params.push(organizationId);
        where.push(`c.organization_id::text = $${params.length}`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sitesCountExpr =
        hasSites && sitesHasClientId
          ? `(SELECT count(*)::int FROM public.sites s WHERE s.client_id = c.id)`
          : `0`;

      const devicesCountExpr =
        hasDevices && devicesHasClientId
          ? `(SELECT count(*)::int FROM public.devices d WHERE d.client_id = c.id)`
          : hasDevices && devicesHasSiteId && hasSites && sitesHasClientId
            ? `(SELECT count(*)::int
              FROM public.devices d
              JOIN public.sites s ON s.id = d.site_id
             WHERE s.client_id = c.id)`
            : `0`;

      const ticketsCountExpr =
        hasTickets && ticketsHasClientId
          ? `(SELECT count(*)::int FROM public.tickets t WHERE t.client_id = c.id)`
          : hasTickets && ticketsHasSiteId && hasSites && sitesHasClientId
            ? `(SELECT count(*)::int
              FROM public.tickets t
              JOIN public.sites s ON s.id = t.site_id
             WHERE s.client_id = c.id)`
            : hasTickets &&
              ticketsHasDeviceId &&
              hasDevices &&
              devicesHasSiteId &&
              hasSites &&
              sitesHasClientId
              ? `(SELECT count(*)::int
              FROM public.tickets t
              JOIN public.devices d ON d.id = t.device_id
              JOIN public.sites s ON s.id = d.site_id
             WHERE s.client_id = c.id)`
              : `0`;

      const sql = `
        SELECT
          c.id::text AS id,
          c.name AS name,
          jsonb_build_object(
            'sites', ${sitesCountExpr},
            'devices', ${devicesCountExpr},
            'tickets', ${ticketsCountExpr}
          ) AS counts
        FROM public.clients c
        ${whereSql}
        ORDER BY lower(c.name) ASC
      `;

      const { rows } = await this.db.query<any>(sql, params);

      return rows.map((r: any) => ({
        key: String(r.id),
        name: String(r.name ?? ""),
        counts: r.counts ?? {},
      }));
    }

    // fallback (legacy orgs table) – keep behavior, but no org scoping here
    const hasOrgs = await this.tableExists("public.organizations");
    if (hasOrgs) {
      const params: any[] = [];
      const where: string[] = [];

      if (term) {
        params.push(`%${term}%`);
        where.push(`lower(o.name) LIKE lower($${params.length})`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const sql = `
        SELECT
          o.id::text AS id,
          o.name AS name,
          '{}'::jsonb AS counts
        FROM public.organizations o
        ${whereSql}
        ORDER BY lower(o.name) ASC
      `;

      const { rows } = await this.db.query<any>(sql, params);
      return rows.map((r: any) => ({
        key: String(r.id),
        name: String(r.name ?? ""),
        counts: r.counts ?? {},
      }));
    }

    return [];
  }

  /**
   * GET /api/customers/:client/sites
   */
  async listSitesForClient(client: string, organizationId?: string | null) {
    const clientId = await this.resolveClientId(client, organizationId);
    if (!clientId) return [];

    const hasSites = await this.tableExists("public.sites");
    if (!hasSites) return [];

    const sitesHasClientId = await this.columnExists("public", "sites", "client_id");
    if (!sitesHasClientId) return [];

    const sitesHasOrg = await this.columnExists("public", "sites", "organization_id");

    const hasDevices = await this.tableExists("public.devices");
    const hasTickets = await this.tableExists("public.tickets");

    const devicesHasSiteId =
      hasDevices && (await this.columnExists("public", "devices", "site_id"));

    const ticketsHasSiteId =
      hasTickets && (await this.columnExists("public", "tickets", "site_id"));
    const ticketsHasDeviceId =
      hasTickets && (await this.columnExists("public", "tickets", "device_id"));

    const devicesCountExpr =
      hasDevices && devicesHasSiteId
        ? `(SELECT count(*)::int FROM public.devices d WHERE d.site_id = s.id)`
        : `0`;

    const ticketsCountExpr =
      hasTickets && ticketsHasSiteId
        ? `(SELECT count(*)::int FROM public.tickets t WHERE t.site_id = s.id)`
        : hasTickets && ticketsHasDeviceId && hasDevices && devicesHasSiteId
          ? `(SELECT count(*)::int
            FROM public.tickets t
            JOIN public.devices d ON d.id = t.device_id
           WHERE d.site_id = s.id)`
          : `0`;

    const params: any[] = [clientId];
    const where: string[] = [`s.client_id::text = $1`];

    if (sitesHasOrg && organizationId) {
      params.push(organizationId);
      where.push(`s.organization_id::text = $${params.length}`);
    }

    const sql = `
      SELECT
        s.id::text AS id,
        s.name AS name,
        jsonb_build_object(
          'devices', ${devicesCountExpr},
          'tickets', ${ticketsCountExpr}
        ) AS counts
      FROM public.sites s
      WHERE ${where.join(" AND ")}
      ORDER BY lower(s.name) ASC
    `;

    const { rows } = await this.db.query<any>(sql, params);

    return rows.map((r: any) => ({
      key: String(r.id),
      name: String(r.name ?? ""),
      counts: r.counts ?? {},
    }));
  }

  // =========================
  // ✅ CREATE: CLIENT
  // =========================
  async createClient(
    body: { name: string; labels?: any },
    organizationId?: string | null
  ) {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new BadRequestException("Client name is required.");

    const hasClients = await this.tableExists("public.clients");
    if (!hasClients) throw new BadRequestException("public.clients table does not exist.");

    const meta = await this.getColumnsMeta("public", "clients");
    const labels = this.parseLabels(body?.labels);

    const cols: string[] = [];
    const vals: any[] = [];
    const push = (col: string, val: any) => {
      cols.push(col);
      vals.push(val);
    };

    // id (only if required and no default)
    const idMeta = meta["id"];
    let forcedId: string | undefined;
    if (idMeta && idMeta.is_nullable === "NO" && !idMeta.column_default) {
      forcedId = randomUUID();
      push("id", forcedId);
    }

    // organization_id (if exists and we have orgId)
    if (meta["organization_id"] && organizationId) {
      push("organization_id", organizationId);
    } else if (meta["organization_id"] && meta["organization_id"].is_nullable === "NO") {
      // If column is required and we don't have orgId, fail clearly
      throw new BadRequestException("organization_id is required to create a client.");
    }

    // name
    if (!meta["name"]) throw new BadRequestException("public.clients.name column is missing.");
    push("name", name);

    // labels (optional)
    if (meta["labels"] && labels !== undefined) push("labels", labels);

    // created_at / updated_at if required & no default
    const now = new Date();
    const createdMeta = meta["created_at"];
    const updatedMeta = meta["updated_at"];
    if (createdMeta && createdMeta.is_nullable === "NO" && !createdMeta.column_default) {
      push("created_at", now);
    }
    if (updatedMeta && updatedMeta.is_nullable === "NO" && !updatedMeta.column_default) {
      push("updated_at", now);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `
      INSERT INTO public.clients (${cols.join(", ")})
      VALUES (${placeholders})
      RETURNING id::text AS id, name
    `;

    const { rows } = await this.db.query<{ id: string; name: string }>(sql, vals);
    const row = rows?.[0];
    if (!row?.id) return { id: forcedId ?? "", name };
    return { id: row.id, name: row.name ?? name };
  }

  // =========================
  // ✅ CREATE: SITE
  // =========================
  async createSiteForClient(
    clientParam: string,
    body: { name: string; labels?: any },
    organizationId?: string | null
  ) {
    const clientId = await this.resolveClientId(clientParam, organizationId);
    if (!clientId) throw new BadRequestException("Client not found.");

    const name = String(body?.name ?? "").trim();
    if (!name) throw new BadRequestException("Site name is required.");

    const hasSites = await this.tableExists("public.sites");
    if (!hasSites) throw new BadRequestException("public.sites table does not exist.");

    const meta = await this.getColumnsMeta("public", "sites");
    const labels = this.parseLabels(body?.labels);

    const cols: string[] = [];
    const vals: any[] = [];
    const push = (col: string, val: any) => {
      cols.push(col);
      vals.push(val);
    };

    // id (only if required and no default)
    const idMeta = meta["id"];
    let forcedId: string | undefined;
    if (idMeta && idMeta.is_nullable === "NO" && !idMeta.column_default) {
      forcedId = randomUUID();
      push("id", forcedId);
    }

    // organization_id (if exists)
    if (meta["organization_id"] && organizationId) {
      push("organization_id", organizationId);
    } else if (meta["organization_id"] && meta["organization_id"].is_nullable === "NO") {
      throw new BadRequestException("organization_id is required to create a site.");
    }

    // client_id required
    if (!meta["client_id"]) throw new BadRequestException("public.sites.client_id column is missing.");
    push("client_id", clientId);

    // name required
    if (!meta["name"]) throw new BadRequestException("public.sites.name column is missing.");
    push("name", name);

    // labels optional
    if (meta["labels"] && labels !== undefined) push("labels", labels);

    // created_at / updated_at if required & no default
    const now = new Date();
    const createdMeta = meta["created_at"];
    const updatedMeta = meta["updated_at"];
    if (createdMeta && createdMeta.is_nullable === "NO" && !createdMeta.column_default) {
      push("created_at", now);
    }
    if (updatedMeta && updatedMeta.is_nullable === "NO" && !updatedMeta.column_default) {
      push("updated_at", now);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `
      INSERT INTO public.sites (${cols.join(", ")})
      VALUES (${placeholders})
      RETURNING id::text AS id, name, client_id::text AS "clientId"
    `;

    const { rows } = await this.db.query<{ id: string; name: string; clientId: string }>(sql, vals);
    const row = rows?.[0];
    if (!row?.id) return { id: forcedId ?? "", clientId, name };
    return { id: row.id, clientId: row.clientId ?? clientId, name: row.name ?? name };
  }

  // =========================
  // ✅ DELETE: SITE
  // =========================
  async deleteSiteForClient(
    clientParam: string,
    siteParam: string,
    organizationId?: string | null
  ) {
    const clientId = await this.resolveClientId(clientParam, organizationId);
    if (!clientId) throw new NotFoundException("Client not found.");

    const siteId = await this.resolveSiteIdForClient(clientId, siteParam, organizationId);
    if (!siteId) throw new NotFoundException("Site not found.");

    const hasDevices = await this.tableExists("public.devices");
    const hasTickets = await this.tableExists("public.tickets");

    const devicesHasSiteId =
      hasDevices && (await this.columnExists("public", "devices", "site_id"));

    const ticketsHasSiteId =
      hasTickets && (await this.columnExists("public", "tickets", "site_id"));

    if (devicesHasSiteId) {
      const { rows } = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.devices WHERE site_id::text = $1`,
        [siteId]
      );
      if ((rows?.[0]?.n ?? 0) > 0) {
        throw new ConflictException("Site has devices. Move/delete devices first.");
      }
    }

    if (ticketsHasSiteId) {
      const { rows } = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.tickets WHERE site_id::text = $1`,
        [siteId]
      );
      if ((rows?.[0]?.n ?? 0) > 0) {
        throw new ConflictException("Site has tickets. Move/close/delete tickets first.");
      }
    }

    const hasSites = await this.tableExists("public.sites");
    if (!hasSites) throw new BadRequestException("public.sites table does not exist.");

    const sitesHasClientId = await this.columnExists("public", "sites", "client_id");
    if (!sitesHasClientId) throw new BadRequestException("public.sites.client_id column is missing.");

    const sitesHasOrg = await this.columnExists("public", "sites", "organization_id");

    const params: any[] = [siteId, clientId];
    const where: string[] = [`id::text = $1`, `client_id::text = $2`];

    if (sitesHasOrg && organizationId) {
      params.push(organizationId);
      where.push(`organization_id::text = $${params.length}`);
    }

    const { rows } = await this.db.query<{ id: string; name: string }>(
      `
      DELETE FROM public.sites
      WHERE ${where.join(" AND ")}
      RETURNING id::text AS id, name
      `,
      params
    );

    if (!rows?.length) throw new NotFoundException("Site not found (or not in your org).");
    return { deleted: true, id: rows[0].id, name: rows[0].name };
  }

  // =========================
  // ✅ DELETE: CLIENT
  // =========================
  async deleteClient(
    clientParam: string,
    opts: { force?: boolean } = {},
    organizationId?: string | null
  ) {
    const clientId = await this.resolveClientId(clientParam, organizationId);
    if (!clientId) throw new NotFoundException("Client not found.");

    const hasSites = await this.tableExists("public.sites");
    const hasDevices = await this.tableExists("public.devices");
    const hasTickets = await this.tableExists("public.tickets");

    const sitesHasClientId =
      hasSites && (await this.columnExists("public", "sites", "client_id"));

    const devicesHasClientId =
      hasDevices && (await this.columnExists("public", "devices", "client_id"));
    const devicesHasSiteId =
      hasDevices && (await this.columnExists("public", "devices", "site_id"));

    const ticketsHasClientId =
      hasTickets && (await this.columnExists("public", "tickets", "client_id"));
    const ticketsHasSiteId =
      hasTickets && (await this.columnExists("public", "tickets", "site_id"));

    // Block delete if any devices/tickets directly reference client
    if (devicesHasClientId) {
      const { rows } = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.devices WHERE client_id::text = $1`,
        [clientId]
      );
      if ((rows?.[0]?.n ?? 0) > 0) {
        throw new ConflictException("Client has devices. Move/delete devices first.");
      }
    }

    if (ticketsHasClientId) {
      const { rows } = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.tickets WHERE client_id::text = $1`,
        [clientId]
      );
      if ((rows?.[0]?.n ?? 0) > 0) {
        throw new ConflictException("Client has tickets. Move/close/delete tickets first.");
      }
    }

    // If there are sites, only allow delete if force=true AND those sites are empty
    if (hasSites && sitesHasClientId) {
      const { rows: siteRows } = await this.db.query<{ id: string; name: string }>(
        `SELECT id::text AS id, name FROM public.sites WHERE client_id::text = $1`,
        [clientId]
      );

      if (siteRows.length > 0 && !opts.force) {
        throw new ConflictException(
          "Client has sites. Delete sites first, or call DELETE with ?force=true (only works if sites have no devices/tickets)."
        );
      }

      if (siteRows.length > 0 && opts.force) {
        const siteIds = siteRows.map((s) => s.id);

        if (devicesHasSiteId) {
          const { rows } = await this.db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.devices WHERE site_id::text = ANY($1::text[])`,
            [siteIds]
          );
          if ((rows?.[0]?.n ?? 0) > 0) {
            throw new ConflictException("One or more sites have devices. Cannot force-delete client.");
          }
        }

        if (ticketsHasSiteId) {
          const { rows } = await this.db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.tickets WHERE site_id::text = ANY($1::text[])`,
            [siteIds]
          );
          if ((rows?.[0]?.n ?? 0) > 0) {
            throw new ConflictException("One or more sites have tickets. Cannot force-delete client.");
          }
        }

        // Delete sites first
        await this.db.query(
          `DELETE FROM public.sites WHERE client_id::text = $1`,
          [clientId]
        );
      }
    }

    const hasClients = await this.tableExists("public.clients");
    if (!hasClients) throw new BadRequestException("public.clients table does not exist.");

    const clientsHasOrg = await this.columnExists("public", "clients", "organization_id");

    const params: any[] = [clientId];
    const where: string[] = [`id::text = $1`];

    if (clientsHasOrg && organizationId) {
      params.push(organizationId);
      where.push(`organization_id::text = $${params.length}`);
    }

    const { rows } = await this.db.query<{ id: string; name: string }>(
      `
      DELETE FROM public.clients
      WHERE ${where.join(" AND ")}
      RETURNING id::text AS id, name
      `,
      params
    );

    if (!rows?.length) throw new NotFoundException("Client not found (or not in your org).");
    return { deleted: true, id: rows[0].id, name: rows[0].name };
  }
}
