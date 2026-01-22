// backend/src/devices/devices.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

export type Device = {
  id: string;
  hostname: string;
  os: string;
  arch?: string | null;
  lastSeen: string | null;
  status: "online" | "offline";
  client?: string | null;
  site?: string | null;
  user?: string | null;
  version?: string | null;
  primaryIp?: string | null;
  agentUuid?: string | null; // <-- present when sourced from agents
};

function decodeCursor(cur?: string | null) {
  if (!cur) return 0;
  try {
    const n = parseInt(Buffer.from(cur, "base64url").toString("utf8"), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function encodeCursor(n: number) {
  return Buffer.from(String(n), "utf8").toString("base64url");
}

@Injectable()
export class DevicesService {
  constructor(private readonly pg: PgPoolService) { }

  async list(opts: {
    pageSize: number;
    cursor?: string | null;
    q?: string;
    status?: "online" | "offline";
    os?: string[];
  }): Promise<{ items: Device[]; nextCursor: string | null }> {
    const { pageSize, cursor, q, status, os } = opts;
    const offset = decodeCursor(cursor);

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (q && q.trim()) {
      where.push(`hostname ILIKE $${p++}`);
      params.push(`%${q.trim()}%`);
    }
    if (status) {
      where.push(`status = $${p++}`);
      params.push(status);
    }
    if (os && os.length) {
      where.push(`lower(os) = ANY($${p++})`);
      params.push(os.map((o) => String(o).toLowerCase()));
    }

    const limit = pageSize + 1;
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      WITH agent_rows AS (
        SELECT
          a.id::text                                           AS id,
          COALESCE(a.hostname, d.hostname, a.device_id::text, 'unknown') AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown')  AS os,
          d.architecture                                       AS arch,
          COALESCE(a.last_check_in_at, d.last_seen_at)         AS last_seen,
          CASE
            WHEN a.last_check_in_at IS NOT NULL
             AND a.last_check_in_at > NOW() - INTERVAL '5 minutes'
            THEN 'online'
            ELSE CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END
          END                                                  AS status,
          c.name::text                                         AS client,
          s.name::text                                         AS site,
          NULL::text                                           AS "user",
          NULLIF(a.version, '')                                AS version,
          NULLIF(a.facts->>'primary_ip', '')                   AS primary_ip,
          a.agent_uuid::text                                   AS agent_uuid
        FROM public.agents a
        LEFT JOIN public.devices d ON d.id = a.device_id
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
      ),
      device_rows AS (
        SELECT
          d.id::text            AS id,
          d.hostname            AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown') AS os,
          d.architecture        AS arch,
          d.last_seen_at        AS last_seen,
          CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END AS status,
          c.name::text          AS client,
          s.name::text          AS site,
          NULL::text            AS "user",
          NULL::text            AS version,
          NULL::text            AS primary_ip,
          NULL::text            AS agent_uuid
        FROM public.devices d
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.agents a
          WHERE COALESCE(a.hostname, d.hostname, a.device_id::text, 'unknown') = d.hostname
        )
      ),
      all_devs AS (
        SELECT * FROM agent_rows
        UNION ALL
        SELECT * FROM device_rows
      )
      SELECT id, hostname, os, arch, last_seen, status, client, site, "user", version, primary_ip, agent_uuid
      FROM all_devs
      ${whereSql}
      ORDER BY hostname ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const { rows } = await this.pg.query(sql, params);
    const hasNext = rows.length > pageSize;

    const items = rows.slice(0, pageSize).map((r: any) => ({
      id: r.id,
      hostname: r.hostname,
      os: r.os,
      arch: r.arch ?? null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      status: r.status as "online" | "offline",
      client: r.client ?? null,
      site: r.site ?? null,
      user: r.user ?? null,
      version: r.version ?? null,
      primaryIp: r.primary_ip ?? null,
      agentUuid: r.agent_uuid ?? null,
    })) as Device[];

    return { items, nextCursor: hasNext ? encodeCursor(offset + pageSize) : null };
  }

  async getOne(id: string): Promise<Device | null> {
    const sql = `
      WITH rows AS (
        SELECT
          0                                                    AS pref,
          a.id::text                                           AS id,
          COALESCE(a.hostname, d.hostname, a.device_id::text, 'unknown') AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown')   AS os,
          d.architecture                                       AS arch,
          COALESCE(a.last_check_in_at, d.last_seen_at)          AS last_seen,
          CASE
            WHEN a.last_check_in_at IS NOT NULL
             AND a.last_check_in_at > NOW() - INTERVAL '5 minutes'
            THEN 'online'
            ELSE CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END
          END                                                  AS status,
          c.name::text                                         AS client,
          s.name::text                                         AS site,
          NULL::text                                           AS "user",
          NULLIF(a.version, '')                                AS version,
          NULLIF(a.facts->>'primary_ip', '')                    AS primary_ip,
          a.agent_uuid::text                                   AS agent_uuid
        FROM public.agents a
        LEFT JOIN public.devices d ON d.id = a.device_id
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        WHERE a.id::text = $1

        UNION ALL

        SELECT
          1                        AS pref,
          d.id::text               AS id,
          d.hostname               AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown') AS os,
          d.architecture           AS arch,
          d.last_seen_at           AS last_seen,
          CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END AS status,
          c.name::text             AS client,
          s.name::text             AS site,
          NULL::text               AS "user",
          NULL::text               AS version,
          NULL::text               AS primary_ip,
          NULL::text               AS agent_uuid
        FROM public.devices d
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        WHERE d.id::text = $1
      )
      SELECT id, hostname, os, arch, last_seen, status, client, site, "user", version, primary_ip, agent_uuid
      FROM rows
      ORDER BY pref ASC
      LIMIT 1;
    `;

    const { rows } = await this.pg.query(sql, [id]);
    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      hostname: r.hostname,
      os: r.os,
      arch: r.arch ?? null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      status: r.status as "online" | "offline",
      client: r.client ?? null,
      site: r.site ?? null,
      user: r.user ?? null,
      version: r.version ?? null,
      primaryIp: r.primary_ip ?? null,
      agentUuid: r.agent_uuid ?? null,
    };
  }

  async listSoftware(
    id: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      version: string;
      publisher?: string | null;
      installDate?: string | null;
    }>
  > {
    const { rows } = await this.pg.query(
      `
      SELECT
        s.id::text            AS id,
        s.name,
        s.version,
        s.publisher,
        s.install_date        AS install_date
      FROM public.agent_software s
      JOIN public.agents a ON a.id = s.agent_id
      WHERE a.id::text = $1
      ORDER BY lower(s.name) ASC, COALESCE(s.version,'') ASC
      `,
      [id]
    );

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      version: r.version ?? "",
      publisher: r.publisher ?? null,
      installDate: r.install_date ?? null,
    }));
  }

  /**
   * Move a device to another site, but ONLY within the same client.
   * Accepts either:
   * - a devices.id UUID
   * - or an agents.id (because your UI/device pages often use the agent row id)
   *
   * It updates public.devices.site_id (if the device row exists).
   */
  async moveToSite(deviceOrAgentId: string, targetSiteId: string): Promise<Device> {
    const rawId = String(deviceOrAgentId ?? "").trim();
    const siteId = String(targetSiteId ?? "").trim();

    if (!rawId) throw new BadRequestException("id is required");
    if (!siteId) throw new BadRequestException("siteId is required");

    // Resolve to the underlying public.devices.id
    const deviceId = await this.resolveDeviceRowId(rawId);
    if (!deviceId) throw new NotFoundException("Device not found");

    // Look up current client via current site_id
    const cur = await this.pg.query<{ client_id: string | null }>(
      `
      SELECT s.client_id::text AS client_id
      FROM public.devices d
      LEFT JOIN public.sites s ON s.id = d.site_id
      WHERE d.id = $1::uuid
      LIMIT 1
      `,
      [deviceId]
    );
    const currentClientId = cur.rows[0]?.client_id ?? null;

    // Look up target site's client
    const tgt = await this.pg.query<{ client_id: string }>(
      `
      SELECT s.client_id::text AS client_id
      FROM public.sites s
      WHERE s.id = $1::uuid
      LIMIT 1
      `,
      [siteId]
    );
    const targetClientId = tgt.rows[0]?.client_id ?? null;
    if (!targetClientId) throw new NotFoundException("Target site not found");

    // Enforce: cannot move across clients (if device has a client)
    if (currentClientId && targetClientId && currentClientId !== targetClientId) {
      throw new BadRequestException("Device cannot be moved to a site under a different client.");
    }

    // Update
    await this.pg.query(
      `
      UPDATE public.devices
      SET site_id = $2::uuid
      WHERE id = $1::uuid
      `,
      [deviceId, siteId]
    );

    // Return updated (now includes client/site names due to joins)
    const updated = (await this.getOne(rawId)) || (await this.getOne(deviceId));
    if (!updated) throw new NotFoundException("Device not found after update");
    return updated;
  }

  private async resolveDeviceRowId(deviceOrAgentId: string): Promise<string | null> {
    // Try as a devices.id (uuid)
    const asDevice = await this.pg.query<{ id: string }>(
      `SELECT d.id::text AS id FROM public.devices d WHERE d.id::text = $1 LIMIT 1`,
      [deviceOrAgentId]
    );
    if (asDevice.rows[0]?.id) return asDevice.rows[0].id;

    // Try as an agents.id -> device_id
    const asAgent = await this.pg.query<{ device_id: string }>(
      `SELECT a.device_id::text AS device_id FROM public.agents a WHERE a.id::text = $1 LIMIT 1`,
      [deviceOrAgentId]
    );
    if (asAgent.rows[0]?.device_id) return asAgent.rows[0].device_id;

    return null;
  }

  // NEW: create uninstall job in a simple job queue
  async requestUninstall(id: string, body: { name: string; version?: string | null }): Promise<string> {
    // ensure agent exists
    const { rows: arows } = await this.pg.query(`SELECT id FROM public.agents WHERE id::text = $1`, [id]);
    const agentId: number | undefined = arows[0]?.id;
    if (!agentId) throw new NotFoundException("Agent not found");

    const payload = {
      action: "uninstall_software",
      name: body.name,
      version: body.version ?? null,
    };

    const { rows } = await this.pg.query(
      `
      INSERT INTO public.agent_jobs (agent_id, kind, payload)
      VALUES ($1, $2, $3::jsonb)
      RETURNING id::text AS id
      `,
      [agentId, "uninstall_software", JSON.stringify(payload)]
    );

    return rows[0].id as string;
  }
}
