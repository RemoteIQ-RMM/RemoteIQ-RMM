import { BadRequestException, Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { ListTicketsQuery } from "./dto/list-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";

export type Ticket = {
  id: string;

  // Backward compatible API naming:
  // customerId == organizationId in DB
  customerId: string | null;

  title: string;
  description: string | null;

  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";

  assigneeUserId: string | null;

  // Not in DB schema right now (DB uses requester_contact_id)
  requesterEmail: string | null;

  createdAt: string;
  updatedAt: string;
  closedAt: string | null;

  ticketNumber: number | null;
  requesterContactId: string | null;
  deviceId: string | null;
};

const STATUS_ALLOW = new Set<Ticket["status"]>(["open", "in_progress", "resolved", "closed"]);
const PRIORITY_ALLOW = new Set<Ticket["priority"]>(["low", "medium", "high", "urgent"]);

/**
 * DB enum mismatch fix:
 * - API uses: low | medium | high | urgent
 * - DB uses:  low | normal | high | urgent   (no "medium")
 */
function priorityApiToDb(p: string): string {
  const v = String(p ?? "").toLowerCase();
  return v === "medium" ? "normal" : v;
}
function priorityDbToApi(p: string): Ticket["priority"] {
  const v = String(p ?? "").toLowerCase();
  return (v === "normal" ? "medium" : v) as Ticket["priority"];
}

function getOrgIdFromReq(req: any): string | null {
  const u = req?.user ?? req?.auth ?? null;
  return u?.organizationId ?? u?.organization_id ?? u?.orgId ?? u?.org_id ?? null;
}

@Injectable()
export class TicketsService {
  constructor(private readonly db: PgPoolService) { }

  async list(
    q: ListTicketsQuery,
    req: any
  ): Promise<{ items: Ticket[]; page: number; pageSize: number; total: number }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 25), 200);
    const offset = (page - 1) * pageSize;

    // customerId is legacy; organizationId is preferred
    const orgId = q.organizationId ?? q.customerId ?? getOrgIdFromReq(req);

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    // If we can infer org, scope by default (secure multi-tenant default)
    if (orgId) {
      where.push(`t.organization_id::text = $${p++}`);
      params.push(orgId);
    }

    if (q.status && STATUS_ALLOW.has(q.status)) {
      where.push(`t.status = $${p++}`);
      params.push(q.status);
    }

    if (q.priority && PRIORITY_ALLOW.has(q.priority)) {
      where.push(`t.priority = $${p++}`);
      params.push(priorityApiToDb(q.priority));
    }

    if (q.search) {
      where.push(`(t.subject ILIKE $${p} OR t.description ILIKE $${p})`);
      params.push(`%${q.search.trim()}%`);
      p++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countSql = `
      SELECT COUNT(*)::int AS n
      FROM tickets t
      ${whereSql};
    `;
    const { rows: countRows } = await this.db.query<{ n: number }>(countSql, params);
    const total = countRows[0]?.n ?? 0;

    const listSql = `
      SELECT
        t.id::text                    AS id,
        t.organization_id::text       AS "customerId",
        t.ticket_number::bigint       AS "ticketNumber",
        t.requester_contact_id::text  AS "requesterContactId",
        t.device_id::text             AS "deviceId",
        t.subject                     AS title,
        NULLIF(t.description,'')      AS description,
        t.status                      AS status,
        t.priority                    AS priority,
        t.assignee_user_id::text      AS "assigneeUserId",
        t.created_at                  AS "createdAt",
        t.updated_at                  AS "updatedAt",
        t.closed_at                   AS "closedAt"
      FROM tickets t
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset};
    `;
    const { rows } = await this.db.query(listSql, params);

    const items = rows.map((r: any) => ({
      id: r.id,
      customerId: r.customerId ?? null,
      ticketNumber: r.ticketNumber !== null && r.ticketNumber !== undefined ? Number(r.ticketNumber) : null,
      requesterContactId: r.requesterContactId ?? null,
      deviceId: r.deviceId ?? null,

      title: r.title,
      description: r.description ?? null,

      status: r.status,
      priority: priorityDbToApi(r.priority),

      assigneeUserId: r.assigneeUserId ?? null,

      requesterEmail: null,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
    })) as Ticket[];

    return { items, page, pageSize, total };
  }

  async getOne(id: string, req: any): Promise<Ticket | null> {
    const orgId = getOrgIdFromReq(req);

    const where: string[] = [`t.id::text = $1`];
    const params: any[] = [id];

    if (orgId) {
      where.push(`t.organization_id::text = $2`);
      params.push(orgId);
    }

    const sql = `
      SELECT
        t.id::text                    AS id,
        t.organization_id::text       AS "customerId",
        t.ticket_number::bigint       AS "ticketNumber",
        t.requester_contact_id::text  AS "requesterContactId",
        t.device_id::text             AS "deviceId",
        t.subject                     AS title,
        NULLIF(t.description,'')      AS description,
        t.status                      AS status,
        t.priority                    AS priority,
        t.assignee_user_id::text      AS "assigneeUserId",
        t.created_at                  AS "createdAt",
        t.updated_at                  AS "updatedAt",
        t.closed_at                   AS "closedAt"
      FROM tickets t
      WHERE ${where.join(" AND ")}
      LIMIT 1;
    `;
    const { rows } = await this.db.query(sql, params);
    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      customerId: r.customerId ?? null,
      ticketNumber: r.ticketNumber !== null && r.ticketNumber !== undefined ? Number(r.ticketNumber) : null,
      requesterContactId: r.requesterContactId ?? null,
      deviceId: r.deviceId ?? null,

      title: r.title,
      description: r.description ?? null,

      status: r.status,
      priority: priorityDbToApi(r.priority),

      assigneeUserId: r.assigneeUserId ?? null,
      requesterEmail: null,

      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
    };
  }

  async create(dto: CreateTicketDto, req: any): Promise<string> {
    const orgId = dto.organizationId ?? dto.customerId ?? getOrgIdFromReq(req);
    if (!orgId) {
      throw new BadRequestException("organizationId is required (not found in request session or payload)");
    }

    const title = String(dto.subject ?? dto.title ?? "").trim();
    if (!title) throw new BadRequestException("subject/title is required");

    const status = String(dto.status ?? "open").toLowerCase() as Ticket["status"];
    const priorityApi = String(dto.priority ?? "medium").toLowerCase() as Ticket["priority"];

    if (!STATUS_ALLOW.has(status)) throw new BadRequestException("Invalid status");
    if (!PRIORITY_ALLOW.has(priorityApi)) throw new BadRequestException("Invalid priority");

    const priorityDb = priorityApiToDb(priorityApi);

    // IMPORTANT:
    // ticket_number is NOT NULL in your DB, so we must generate it.
    //
    // This computes next number per-organization using MAX()+1 in one statement.
    // Recommended hardening: add UNIQUE (organization_id, ticket_number) and keep retry loop.
    const sql = `
      WITH next_num AS (
        SELECT COALESCE(MAX(t.ticket_number), 0) + 1 AS n
        FROM tickets t
        WHERE t.organization_id = $1
      )
      INSERT INTO tickets
        (organization_id, ticket_number, subject, description, status, priority, assignee_user_id, requester_contact_id, device_id, created_at, updated_at)
      SELECT
        $1, next_num.n, $2, $3, $4, $5, $6, $7, $8, now(), now()
      FROM next_num
      RETURNING id::text AS id;
    `;

    const params = [
      orgId,
      title,
      dto.description ?? null,
      status,
      priorityDb,
      dto.assigneeUserId ?? null,
      dto.requesterContactId ?? null,
      dto.deviceId ?? null,
    ];

    // Retry helps if you add a UNIQUE constraint on (organization_id, ticket_number)
    // and two creates happen at the same time.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await this.db.query<{ id: string }>(sql, params);
        return rows[0].id;
      } catch (err: any) {
        // 23505 = unique_violation (only helpful if you add the unique constraint)
        if (err?.code === "23505" && attempt < 4) continue;
        throw err;
      }
    }

    // Should never hit
    throw new Error("Failed to create ticket");
  }

  async update(id: string, dto: UpdateTicketDto, req: any): Promise<boolean> {
    const orgId = getOrgIdFromReq(req);

    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    const nextOrg = dto.organizationId ?? dto.customerId;
    if (nextOrg !== undefined) {
      sets.push(`organization_id = $${p++}`);
      params.push(nextOrg);
    }

    if (dto.subject !== undefined || dto.title !== undefined) {
      const nextTitle = String(dto.subject ?? dto.title ?? "").trim();
      if (!nextTitle) throw new BadRequestException("subject/title cannot be empty");
      sets.push(`subject = $${p++}`);
      params.push(nextTitle);
    }

    if (dto.description !== undefined) {
      sets.push(`description = $${p++}`);
      params.push(dto.description);
    }

    if (dto.status !== undefined) {
      const s = String(dto.status).toLowerCase() as Ticket["status"];
      if (!STATUS_ALLOW.has(s)) throw new BadRequestException("Invalid status");
      sets.push(`status = $${p++}`);
      params.push(s);
    }

    if (dto.priority !== undefined) {
      const prApi = String(dto.priority).toLowerCase() as Ticket["priority"];
      if (!PRIORITY_ALLOW.has(prApi)) throw new BadRequestException("Invalid priority");
      sets.push(`priority = $${p++}`);
      params.push(priorityApiToDb(prApi));
    }

    if (dto.assigneeUserId !== undefined) {
      sets.push(`assignee_user_id = $${p++}`);
      params.push(dto.assigneeUserId);
    }

    if (dto.requesterContactId !== undefined) {
      sets.push(`requester_contact_id = $${p++}`);
      params.push(dto.requesterContactId);
    }

    if (dto.deviceId !== undefined) {
      sets.push(`device_id = $${p++}`);
      params.push(dto.deviceId);
    }

    if (dto.closedAt !== undefined) {
      if (dto.closedAt === null) {
        sets.push(`closed_at = NULL`);
      } else {
        sets.push(`closed_at = $${p++}`);
        params.push(dto.closedAt);
      }
    }

    if (sets.length === 0) return true;

    sets.push(`updated_at = now()`);

    let where = `id::text = $${p}`;
    params.push(id);
    if (orgId) {
      where += ` AND organization_id::text = $${p + 1}`;
      params.push(orgId);
    }

    const sql = `
      UPDATE tickets
      SET ${sets.join(", ")}
      WHERE ${where};
    `;
    await this.db.query(sql, params);

    const exists = await this.getOne(id, req);
    return !!exists;
  }
}
