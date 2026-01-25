// backend/src/devices/devices.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

export type Device = {
  id: string; // agent id when present, else devices.id
  deviceId?: string | null; // ALWAYS the underlying public.devices.id (uuid)
  hostname: string;
  os: string;
  arch?: string | null;
  lastSeen: string | null;
  status: "online" | "offline";

  deletionStatus?: "pending" | null;

  clientId?: string | null;
  siteId?: string | null;

  client?: string | null;
  site?: string | null;

  user?: string | null;
  version?: string | null;
  primaryIp?: string | null;

  agentUuid?: string | null; // present when sourced from agents

  // ✅ raw agent facts (jsonb) when present (agent-sourced rows)
  facts?: Record<string, any> | null;
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
  private deletionTableReady = false;

  constructor(private readonly pg: PgPoolService) { }

  private async ensureDeviceDeletionRequestsTable(): Promise<void> {
    if (this.deletionTableReady) return;

    // NOTE: gen_random_uuid() requires pgcrypto extension.
    // If you don't have it enabled, you'll need:
    //   CREATE EXTENSION IF NOT EXISTS pgcrypto;
    await this.pg.query(`
      CREATE TABLE IF NOT EXISTS public.device_deletion_requests (
        id uuid PRIMARY KEY,
        device_id uuid NOT NULL UNIQUE,
        status text NOT NULL, -- 'pending' | 'completed'
        requested_by_user_id uuid NULL,
        requested_at timestamptz NOT NULL DEFAULT NOW(),
        approved_by_user_id uuid NULL,
        approved_at timestamptz NULL,
        completed_at timestamptz NULL
      );
    `);

    await this.pg.query(`
      CREATE INDEX IF NOT EXISTS device_deletion_requests_status_idx
      ON public.device_deletion_requests (status);
    `);

    this.deletionTableReady = true;
  }

  async list(opts: {
    pageSize: number;
    cursor?: string | null;
    q?: string;
    status?: "online" | "offline";
    os?: string[];
  }): Promise<{ items: Device[]; nextCursor: string | null }> {
    await this.ensureDeviceDeletionRequestsTable();

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
          a.id::text AS id,
          a.device_id::text AS device_id,

          COALESCE(a.hostname, d.hostname, a.device_id::text, 'unknown') AS hostname,

          -- agent-reported OS (facts.os) fallback to device row
          COALESCE(NULLIF(a.facts->>'os', ''), NULLIF(d.operating_system, ''), 'unknown') AS os,

          -- agent-reported arch (facts.arch) fallback to device row
          COALESCE(NULLIF(a.facts->>'arch', ''), d.architecture, NULL) AS arch,

          COALESCE(a.last_check_in_at, d.last_seen_at) AS last_seen,

          CASE
            WHEN a.last_check_in_at IS NOT NULL
             AND a.last_check_in_at > NOW() - INTERVAL '5 minutes'
            THEN 'online'
            ELSE CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END
          END AS status,

          c.id::text AS client_id,
          s.id::text AS site_id,
          c.name::text AS client,
          s.name::text AS site,

          -- deletion status (pending only)
          dr.status::text AS deletion_status,

          -- agent-reported logged in user
          COALESCE(
            NULLIF(a.facts->>'user', ''),
            NULLIF(a.facts->>'logged_in_user', ''),
            NULL
          ) AS "user",

          NULLIF(a.version, '') AS version,
          NULLIF(a.facts->>'primary_ip', '') AS primary_ip,

          COALESCE(NULLIF(a.agent_uuid, ''), a.id::text) AS agent_uuid,

          -- ✅ raw facts for UI (jsonb)
          a.facts AS facts
        FROM public.agents a
        LEFT JOIN public.devices d ON d.id = a.device_id
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        LEFT JOIN public.device_deletion_requests dr
          ON dr.device_id = d.id AND dr.status = 'pending'
      ),
      device_rows AS (
        SELECT
          d.id::text            AS id,
          d.id::text            AS device_id,
          d.hostname            AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown') AS os,
          d.architecture        AS arch,
          d.last_seen_at        AS last_seen,
          CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END AS status,

          c.id::text            AS client_id,
          s.id::text            AS site_id,
          c.name::text          AS client,
          s.name::text          AS site,

          -- deletion status (pending only)
          dr.status::text       AS deletion_status,

          NULL::text            AS "user",
          NULL::text            AS version,
          NULL::text            AS primary_ip,
          NULL::text            AS agent_uuid,

          -- ✅ no agent facts on device-only rows
          NULL::jsonb           AS facts
        FROM public.devices d
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        LEFT JOIN public.device_deletion_requests dr
          ON dr.device_id = d.id AND dr.status = 'pending'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.agents a
          WHERE a.device_id = d.id
        )
      ),
      all_devs AS (
        SELECT * FROM agent_rows
        UNION ALL
        SELECT * FROM device_rows
      )
      SELECT
        id,
        device_id,
        hostname,
        os,
        arch,
        last_seen,
        status,
        client_id,
        site_id,
        client,
        site,
        deletion_status,
        "user",
        version,
        primary_ip,
        agent_uuid,
        facts
      FROM all_devs
      ${whereSql}
      ORDER BY hostname ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const { rows } = await this.pg.query(sql, params);
    const hasNext = rows.length > pageSize;

    const items = rows.slice(0, pageSize).map((r: any) => ({
      id: r.id,
      deviceId: r.device_id ?? null,
      hostname: r.hostname,
      os: r.os,
      arch: r.arch ?? null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      status: r.status as "online" | "offline",

      deletionStatus: (r.deletion_status ?? null) as "pending" | null,

      clientId: r.client_id ?? null,
      siteId: r.site_id ?? null,

      client: r.client ?? null,
      site: r.site ?? null,

      user: r.user ?? null,
      version: r.version ?? null,
      primaryIp: r.primary_ip ?? null,
      agentUuid: r.agent_uuid ?? null,

      facts: r.facts ?? null,
    })) as Device[];

    return { items, nextCursor: hasNext ? encodeCursor(offset + pageSize) : null };
  }

  async getOne(id: string): Promise<Device | null> {
    await this.ensureDeviceDeletionRequestsTable();

    const sql = `
      WITH rows AS (
        SELECT
          0 AS pref,
          a.id::text AS id,
          a.device_id::text AS device_id,

          COALESCE(a.hostname, d.hostname, a.device_id::text, 'unknown') AS hostname,
          COALESCE(NULLIF(a.facts->>'os', ''), NULLIF(d.operating_system, ''), 'unknown') AS os,
          COALESCE(NULLIF(a.facts->>'arch', ''), d.architecture, NULL) AS arch,
          COALESCE(a.last_check_in_at, d.last_seen_at) AS last_seen,
          CASE
            WHEN a.last_check_in_at IS NOT NULL
             AND a.last_check_in_at > NOW() - INTERVAL '5 minutes'
            THEN 'online'
            ELSE CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END
          END AS status,

          c.id::text AS client_id,
          s.id::text AS site_id,
          c.name::text AS client,
          s.name::text AS site,

          dr.status::text AS deletion_status,

          COALESCE(
            NULLIF(a.facts->>'user', ''),
            NULLIF(a.facts->>'logged_in_user', ''),
            NULL
          ) AS "user",
          NULLIF(a.version, '') AS version,
          NULLIF(a.facts->>'primary_ip', '') AS primary_ip,
          COALESCE(NULLIF(a.agent_uuid, ''), a.id::text) AS agent_uuid,

          -- ✅ raw facts for UI
          a.facts AS facts
        FROM public.agents a
        LEFT JOIN public.devices d ON d.id = a.device_id
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        LEFT JOIN public.device_deletion_requests dr
          ON dr.device_id = d.id AND dr.status = 'pending'
        WHERE a.id::text = $1 OR a.device_id::text = $1

        UNION ALL

        SELECT
          1 AS pref,
          d.id::text AS id,
          d.id::text AS device_id,
          d.hostname AS hostname,
          COALESCE(NULLIF(d.operating_system, ''), 'unknown') AS os,
          d.architecture AS arch,
          d.last_seen_at AS last_seen,
          CASE WHEN d.status = 'online' THEN 'online' ELSE 'offline' END AS status,

          c.id::text AS client_id,
          s.id::text AS site_id,
          c.name::text AS client,
          s.name::text AS site,

          dr.status::text AS deletion_status,

          NULL::text AS "user",
          NULL::text AS version,
          NULL::text AS primary_ip,
          NULL::text AS agent_uuid,

          -- ✅ no agent facts on device-only row
          NULL::jsonb AS facts
        FROM public.devices d
        LEFT JOIN public.sites   s ON s.id = d.site_id
        LEFT JOIN public.clients c ON c.id = s.client_id
        LEFT JOIN public.device_deletion_requests dr
          ON dr.device_id = d.id AND dr.status = 'pending'
        WHERE d.id::text = $1
      )
      SELECT
        id,
        device_id,
        hostname,
        os,
        arch,
        last_seen,
        status,
        client_id,
        site_id,
        client,
        site,
        deletion_status,
        "user",
        version,
        primary_ip,
        agent_uuid,
        facts
      FROM rows
      ORDER BY pref ASC
      LIMIT 1;
    `;

    const { rows } = await this.pg.query(sql, [id]);
    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      deviceId: r.device_id ?? null,
      hostname: r.hostname,
      os: r.os,
      arch: r.arch ?? null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      status: r.status as "online" | "offline",

      deletionStatus: (r.deletion_status ?? null) as "pending" | null,

      clientId: r.client_id ?? null,
      siteId: r.site_id ?? null,

      client: r.client ?? null,
      site: r.site ?? null,

      user: r.user ?? null,
      version: r.version ?? null,
      primaryIp: r.primary_ip ?? null,
      agentUuid: r.agent_uuid ?? null,

      facts: r.facts ?? null,
    };
  }

  async requestDeviceDeletion(deviceOrAgentId: string, requestedByUserId: string | null) {
    await this.ensureDeviceDeletionRequestsTable();

    const deviceId = await this.resolveDeviceRowId(String(deviceOrAgentId ?? "").trim());
    if (!deviceId) throw new NotFoundException("Device not found");

    const reqRes = await this.pg.query<{ id: string; status: string }>(
      `
      INSERT INTO public.device_deletion_requests (id, device_id, status, requested_by_user_id)
      VALUES (gen_random_uuid(), $1::uuid, 'pending', $2::uuid)
      ON CONFLICT (device_id) DO UPDATE
        SET status = CASE
          WHEN public.device_deletion_requests.status = 'completed' THEN 'pending'
          ELSE public.device_deletion_requests.status
        END
      RETURNING id::text AS id, status::text AS status
      `,
      [deviceId, requestedByUserId]
    );

    return { deviceId, status: (reqRes.rows[0]?.status ?? "pending") as "pending" };
  }

  async approveAndDeleteDevice(deviceOrAgentId: string, approvedByUserId: string | null) {
    await this.ensureDeviceDeletionRequestsTable();

    const rawId = String(deviceOrAgentId ?? "").trim();
    const deviceId = await this.resolveDeviceRowId(rawId);
    if (!deviceId) throw new NotFoundException("Device not found");

    await this.pg.query("BEGIN");
    try {
      // Ensure a pending row exists (so approvals can happen even if no one requested)
      await this.pg.query(
        `
        INSERT INTO public.device_deletion_requests (id, device_id, status, requested_by_user_id, requested_at)
        VALUES (gen_random_uuid(), $1::uuid, 'pending', NULL, NOW())
        ON CONFLICT (device_id) DO NOTHING
        `,
        [deviceId]
      );

      await this.pg.query(
        `
        UPDATE public.device_deletion_requests
           SET approved_by_user_id = $2::uuid,
               approved_at = NOW()
         WHERE device_id = $1::uuid
           AND status = 'pending'
        `,
        [deviceId, approvedByUserId]
      );

      // Find any agents for this device
      const agentRows = await this.pg.query<{ id: string }>(
        `SELECT a.id::text AS id FROM public.agents a WHERE a.device_id = $1::uuid`,
        [deviceId]
      );
      const agentIds = agentRows.rows.map((r) => r.id);

      // Delete agent-dependent data first (best-effort)
      if (agentIds.length) {
        await this.pg.query(`DELETE FROM public.agent_software WHERE agent_id = ANY($1::uuid[])`, [agentIds]);
        await this.pg.query(`DELETE FROM public.agent_jobs     WHERE agent_id = ANY($1::uuid[])`, [agentIds]);
      }

      // Delete agents then device row
      await this.pg.query(`DELETE FROM public.agents  WHERE device_id = $1::uuid`, [deviceId]);
      await this.pg.query(`DELETE FROM public.devices WHERE id = $1::uuid`, [deviceId]);

      // Mark completed
      await this.pg.query(
        `
        UPDATE public.device_deletion_requests
           SET status = 'completed',
               completed_at = NOW()
         WHERE device_id = $1::uuid
        `,
        [deviceId]
      );

      await this.pg.query("COMMIT");
    } catch (e) {
      await this.pg.query("ROLLBACK");
      throw e;
    }

    return { deleted: true, deviceId };
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

  // create uninstall job in a simple job queue
  async requestUninstall(id: string, body: { name: string; version?: string | null }): Promise<string> {
    // ensure agent exists
    const { rows: arows } = await this.pg.query(`SELECT id FROM public.agents WHERE id::text = $1`, [id]);
    const agentId: string | undefined = arows[0]?.id;
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
