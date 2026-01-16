// backend/src/customers/customers.service.ts

import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

@Injectable()
export class CustomersService {
  constructor(private readonly db: PgPoolService) {}

  private tableExistsCache = new Map<string, boolean>();
  private columnExistsCache = new Map<string, boolean>();

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

  private async columnExists(
    schema: string,
    table: string,
    column: string
  ): Promise<boolean> {
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

  private isUuid(input: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.trim()
    );
  }

  private async resolveClientId(clientParam: string): Promise<string | null> {
    const raw = (clientParam ?? "").trim();
    if (!raw) return null;

    // If it's already a UUID, assume it's the client id
    if (this.isUuid(raw)) return raw;

    // Otherwise, try to resolve by name in public.clients
    const hasClients = await this.tableExists("public.clients");
    if (!hasClients) return null;

    const { rows } = await this.db.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM public.clients
      WHERE lower(name) = lower($1)
      LIMIT 1
      `,
      [raw]
    );

    return rows?.[0]?.id ?? null;
  }

  /**
   * GET /api/customers?q=term
   * Returns clients from public.clients (preferred), with counts derived from sites/devices/tickets.
   * Output shape is compatible with your existing frontend:
   * [{ key, name, counts: { sites, devices, tickets } }]
   */
  async listClients(q: string) {
    const term = (q ?? "").trim();

    const hasClients = await this.tableExists("public.clients");
    const hasSites = await this.tableExists("public.sites");
    const hasDevices = await this.tableExists("public.devices");
    const hasTickets = await this.tableExists("public.tickets");

    // Column checks (we will only reference columns that exist)
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

      // Tickets can be counted in a few ways depending on schema
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
        key: String(r.id), // <-- IMPORTANT: key is UUID for routing /:client/sites
        name: String(r.name ?? ""),
        counts: r.counts ?? {},
      }));
    }

    // Fallback if you don't have public.clients: list organizations (still same response shape)
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
   * client can be a UUID (client_id) or a client name; we resolve it to client_id.
   * Output shape matches your old one:
   * [{ key, name, counts: { devices, tickets } }]
   */
  async listSitesForClient(client: string) {
    const clientId = await this.resolveClientId(client);
    if (!clientId) return [];

    const hasSites = await this.tableExists("public.sites");
    if (!hasSites) return [];

    const sitesHasClientId = await this.columnExists("public", "sites", "client_id");
    if (!sitesHasClientId) return [];

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

    const sql = `
      SELECT
        s.id::text AS id,
        s.name AS name,
        jsonb_build_object(
          'devices', ${devicesCountExpr},
          'tickets', ${ticketsCountExpr}
        ) AS counts
      FROM public.sites s
      WHERE s.client_id::text = $1
      ORDER BY lower(s.name) ASC
    `;

    const { rows } = await this.db.query<any>(sql, [clientId]);

    return rows.map((r: any) => ({
      key: String(r.id), // site id (uuid)
      name: String(r.name ?? ""),
      counts: r.counts ?? {},
    }));
  }
}
