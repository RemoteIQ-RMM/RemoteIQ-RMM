// remoteiq-minimal-e2e/backend/src/tickets/tickets.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { ListTicketsQuery } from "./dto/list-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";
import { randomUUID } from "crypto";

export type Ticket = {
  id: string;

  // Backward compatible API naming:
  customerId: string | null;

  title: string;
  description: string | null;

  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";

  assigneeUserId: string | null;

  requesterEmail: string | null;

  createdAt: string;
  updatedAt: string;
  closedAt: string | null;

  dueAt: string | null;

  ticketNumber: number | null;
  requesterContactId: string | null;
  deviceId: string | null;
};

export type LinkedTicket = { id: string; number?: string | null; title: string; status: string };

export type ActivityItem =
  | {
    id: string;
    kind: "message" | "note";
    author: string;
    body: string;
    createdAt: string;
    isInternal?: boolean;
    attachments?: { id: string; name: string; size?: number; url: string }[];
  }
  | {
    id: string;
    kind: "change";
    createdAt: string;
    actor: string;
    field: "status" | "priority" | "assignee" | "title" | "dueAt" | "collaborators";
    from?: string | null;
    to?: string | null;
  };

const STATUS_ALLOW = new Set<Ticket["status"]>(["open", "in_progress", "resolved", "closed"]);
const PRIORITY_ALLOW = new Set<string>(["low", "normal", "medium", "high", "urgent"]);

function priorityApiToDb(p: string): string {
  const v = String(p ?? "").toLowerCase();
  if (v === "medium") return "normal";
  if (v === "normal") return "normal";
  return v;
}
function priorityDbToApi(p: string): Ticket["priority"] {
  const v = String(p ?? "").toLowerCase();
  return (v === "normal" ? "medium" : v) as Ticket["priority"];
}

function getOrgIdFromReq(req: any): string | null {
  const u = req?.user ?? req?.auth ?? null;
  return u?.organizationId ?? u?.organization_id ?? u?.orgId ?? u?.org_id ?? null;
}

function getActorFromReq(req: any): string {
  const u = req?.user ?? req?.auth ?? null;
  const name = (u?.name ?? u?.fullName ?? "").toString().trim();
  const email = (u?.email ?? u?.username ?? "").toString().trim();
  return name || email || "System";
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isIntLike(s: string): boolean {
  return /^[0-9]+$/.test(String(s ?? "").trim());
}

function isMissingRelationError(err: any): boolean {
  // Postgres: 42P01 = undefined_table
  return err?.code === "42P01";
}

function isUndefinedColumnError(err: any): boolean {
  // Postgres: 42703 = undefined_column
  return err?.code === "42703";
}

@Injectable()
export class TicketsService {
  private activityEnsured = false;

  constructor(private readonly db: PgPoolService) { }

  /**
   * Ensures ticket_activity exists and has the columns required by:
   * - addMessageOrNote()
   * - addChange()
   * - getActivity()
   * - getHistory()
   *
   * This fixes the common “No history entries” symptom caused by schema drift
   * (table exists but missing field/from_value/to_value/created_at).
   */
  private async ensureTicketActivitySchema(): Promise<void> {
    if (this.activityEnsured) return;

    try {
      // Base table (safe if it doesn't exist yet)
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ticket_activity (
          id uuid PRIMARY KEY,
          ticket_id uuid NOT NULL,
          kind text NOT NULL,
          author text NOT NULL,
          body text NULL,
          is_internal boolean NOT NULL DEFAULT false,
          attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
          field text NULL,
          from_value text NULL,
          to_value text NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Add missing columns to existing tables (safe no-ops when present)
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS body text NULL;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS field text NULL;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS from_value text NULL;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS to_value text NULL;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`);

      // Helpful indexes
      await this.db.query(`CREATE INDEX IF NOT EXISTS ticket_activity_ticket_idx ON ticket_activity (ticket_id);`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS ticket_activity_ticket_created_idx ON ticket_activity (ticket_id, created_at);`);

      this.activityEnsured = true;
    } catch {
      // If the DB user can't alter schema, we still don't want hard-fail everywhere.
      // Reads will fall back to [] and writes won't block ticket updates.
      this.activityEnsured = true;
    }
  }

  async list(
    q: ListTicketsQuery,
    req: any
  ): Promise<{ items: Ticket[]; page: number; pageSize: number; total: number }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 25), 200);
    const offset = (page - 1) * pageSize;

    const orgId = q.organizationId ?? q.customerId ?? getOrgIdFromReq(req);

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (orgId) {
      where.push(`t.organization_id::text = $${p++}`);
      params.push(orgId);
    }

    if (q.status && STATUS_ALLOW.has(q.status)) {
      where.push(`t.status = $${p++}`);
      params.push(q.status);
    }

    if (q.priority && PRIORITY_ALLOW.has(String(q.priority).toLowerCase())) {
      where.push(`t.priority = $${p++}`);
      params.push(priorityApiToDb(String(q.priority)));
    }

    // allow searching by UUID prefix, ticket number, subject/description
    if (q.search) {
      where.push(`(
        t.subject ILIKE $${p}
        OR t.description ILIKE $${p}
        OR t.id::text ILIKE $${p}
        OR t.ticket_number::text ILIKE $${p}
      )`);
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
        t.due_at                      AS "dueAt",
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
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
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
        t.due_at                      AS "dueAt",
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
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
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
    const priorityApi = String(dto.priority ?? "medium").toLowerCase();

    if (!STATUS_ALLOW.has(status)) throw new BadRequestException("Invalid status");
    if (!PRIORITY_ALLOW.has(priorityApi)) throw new BadRequestException("Invalid priority");

    const priorityDb = priorityApiToDb(priorityApi);

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

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await this.db.query<{ id: string }>(sql, params);
        return rows[0].id;
      } catch (err: any) {
        if (err?.code === "23505" && attempt < 4) continue;
        throw err;
      }
    }

    throw new Error("Failed to create ticket");
  }

  private async requireTicket(id: string, req: any): Promise<{ id: string; orgId: string | null; row: any }> {
    const orgId = getOrgIdFromReq(req);
    const where: string[] = [`t.id::text = $1`];
    const params: any[] = [id];
    if (orgId) {
      where.push(`t.organization_id::text = $2`);
      params.push(orgId);
    }

    const sql = `
      SELECT
        t.id::text as id,
        t.organization_id::text as "customerId",
        t.subject as title,
        t.status as status,
        t.priority as priority,
        t.assignee_user_id::text as "assigneeUserId",
        t.due_at as "dueAt"
      FROM tickets t
      WHERE ${where.join(" AND ")}
      LIMIT 1;
    `;
    const { rows } = await this.db.query(sql, params);
    const row = rows[0];
    if (!row) throw new NotFoundException("Ticket not found");
    return { id: row.id, orgId: row.customerId ?? null, row };
  }

  private async addChange(
    ticketId: string,
    actor: string,
    field: "status" | "priority" | "assignee" | "title" | "dueAt" | "collaborators",
    from: string | null,
    to: string | null
  ) {
    await this.ensureTicketActivitySchema();

    const sql = `
      INSERT INTO ticket_activity
        (id, ticket_id, kind, author, body, is_internal, attachments, field, from_value, to_value)
      VALUES
        ($1::uuid, $2::uuid, 'change', $3, NULL, true, '[]'::jsonb, $4, $5, $6);
    `;
    await this.db.query(sql, [randomUUID(), ticketId, actor, field, from, to]);
  }

  async update(id: string, dto: UpdateTicketDto, req: any): Promise<boolean> {
    const actor = getActorFromReq(req);
    const before = await this.requireTicket(id, req);

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
      const pr = String(dto.priority).toLowerCase();
      if (!PRIORITY_ALLOW.has(pr)) throw new BadRequestException("Invalid priority");
      sets.push(`priority = $${p++}`);
      params.push(priorityApiToDb(pr));
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

    if ((dto as any).dueAt !== undefined) {
      const dueAt = (dto as any).dueAt as string | null;
      if (dueAt === null) {
        sets.push(`due_at = NULL`);
      } else {
        sets.push(`due_at = $${p++}`);
        params.push(dueAt);
      }
    }

    if ((dto as any).closedAt !== undefined) {
      const closedAt = (dto as any).closedAt as string | null;
      if (closedAt === null) {
        sets.push(`closed_at = NULL`);
      } else {
        sets.push(`closed_at = $${p++}`);
        params.push(closedAt);
      }
    }

    if (sets.length === 0) return true;

    sets.push(`updated_at = now()`);

    const where = `id::text = $${p}`;
    params.push(id);

    const sql = `
      UPDATE tickets
      SET ${sets.join(", ")}
      WHERE ${where};
    `;
    await this.db.query(sql, params);

    // Best-effort audit logging; do not fail the update if this breaks.
    try {
      const after = await this.requireTicket(id, req);

      const beforeTitle = String(before.row.title ?? "");
      const afterTitle = String(after.row.title ?? "");
      if (beforeTitle !== afterTitle) await this.addChange(id, actor, "title", beforeTitle || null, afterTitle || null);

      const beforeStatus = String(before.row.status ?? "");
      const afterStatus = String(after.row.status ?? "");
      if (beforeStatus !== afterStatus) await this.addChange(id, actor, "status", beforeStatus || null, afterStatus || null);

      const beforePr = priorityDbToApi(String(before.row.priority ?? ""));
      const afterPr = priorityDbToApi(String(after.row.priority ?? ""));
      if (beforePr !== afterPr) await this.addChange(id, actor, "priority", beforePr || null, afterPr || null);

      const beforeAssignee = String(before.row.assigneeUserId ?? "");
      const afterAssignee = String(after.row.assigneeUserId ?? "");
      if (beforeAssignee !== afterAssignee) {
        await this.addChange(id, actor, "assignee", beforeAssignee || null, afterAssignee || null);
      }

      const beforeDue = before.row.dueAt ? new Date(before.row.dueAt).toISOString() : null;
      const afterDue = after.row.dueAt ? new Date(after.row.dueAt).toISOString() : null;
      if ((beforeDue ?? null) !== (afterDue ?? null)) await this.addChange(id, actor, "dueAt", beforeDue, afterDue);
    } catch {
      // swallow
    }

    return true;
  }

  async addMessageOrNote(
    ticketId: string,
    req: any,
    kind: "message" | "note",
    payload: {
      body?: string;
      attachments?: { id?: string; name: string; size?: number; url: string }[];
      notifyCustomer?: boolean;
    }
  ) {
    await this.requireTicket(ticketId, req);
    await this.ensureTicketActivitySchema();

    const actor = getActorFromReq(req);
    const body = String(payload?.body ?? "").trim();
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];

    try {
      const sql = `
        INSERT INTO ticket_activity
          (id, ticket_id, kind, author, body, is_internal, attachments)
        VALUES
          ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb);
      `;
      await this.db.query(sql, [
        randomUUID(),
        ticketId,
        kind,
        actor,
        body,
        kind === "note",
        JSON.stringify(attachments),
      ]);
    } catch (err: any) {
      if (isMissingRelationError(err)) return { ok: true };
      throw err;
    }

    return { ok: true };
  }

  async getActivity(ticketId: string, req: any): Promise<ActivityItem[]> {
    await this.requireTicket(ticketId, req);
    await this.ensureTicketActivitySchema();

    try {
      const sql = `
        SELECT
          id::text as id,
          kind,
          author,
          COALESCE(body,'') as body,
          created_at as "createdAt",
          is_internal as "isInternal",
          attachments,
          field,
          from_value as "fromValue",
          to_value as "toValue"
        FROM ticket_activity
        WHERE ticket_id::text = $1
        ORDER BY created_at ASC;
      `;
      const { rows } = await this.db.query(sql, [ticketId]);

      return rows.map((r: any) => {
        if (r.kind === "change") {
          return {
            id: r.id,
            kind: "change",
            createdAt: new Date(r.createdAt).toISOString(),
            actor: String(r.author ?? "System"),
            field: String(r.field ?? "title") as any,
            from: r.fromValue ?? null,
            to: r.toValue ?? null,
          } as ActivityItem;
        }

        const atts = Array.isArray(r.attachments) ? r.attachments : [];
        return {
          id: r.id,
          kind: r.kind,
          author: String(r.author ?? "System"),
          body: String(r.body ?? ""),
          createdAt: new Date(r.createdAt).toISOString(),
          isInternal: !!r.isInternal,
          attachments: atts,
        } as ActivityItem;
      });
    } catch (err: any) {
      if (isMissingRelationError(err) || isUndefinedColumnError(err)) return [];
      throw err;
    }
  }

  async getHistory(ticketId: string, req: any): Promise<{ at: string; who: string; what: string }[]> {
    await this.requireTicket(ticketId, req);
    await this.ensureTicketActivitySchema();

    try {
      const sql = `
        SELECT
          created_at as at,
          author as who,
          field,
          from_value as "fromValue",
          to_value as "toValue"
        FROM ticket_activity
        WHERE ticket_id::text = $1 AND kind = 'change'
        ORDER BY created_at DESC
        LIMIT 100;
      `;
      const { rows } = await this.db.query(sql, [ticketId]);

      return rows.map((r: any) => {
        const f = String(r.field ?? "");
        const fromV = r.fromValue ?? null;
        const toV = r.toValue ?? null;
        return {
          at: new Date(r.at).toISOString(),
          who: String(r.who ?? "System"),
          what: `${f}: ${fromV ?? "-"} -> ${toV ?? "-"}`,
        };
      });
    } catch (err: any) {
      if (isMissingRelationError(err) || isUndefinedColumnError(err)) return [];
      throw err;
    }
  }

  async getLinked(ticketId: string, req: any): Promise<LinkedTicket[]> {
    await this.requireTicket(ticketId, req);

    const orgId = getOrgIdFromReq(req);

    try {
      const params: any[] = [ticketId];
      let orgFilter = "";
      if (orgId) {
        params.push(orgId);
        orgFilter = `AND t.organization_id::text = $2 AND lt.organization_id::text = $2`;
      }

      const sql = `
        SELECT
          lt.id::text as id,
          lt.ticket_number::bigint as "ticketNumber",
          lt.subject as title,
          lt.status as status
        FROM ticket_links l
        JOIN tickets t ON t.id = l.ticket_id
        JOIN tickets lt ON lt.id = l.linked_ticket_id
        WHERE t.id::text = $1
        ${orgFilter}
        ORDER BY lt.created_at DESC;
      `;
      const { rows } = await this.db.query(sql, params);

      return rows.map((r: any) => ({
        id: r.id,
        number: r.ticketNumber !== null && r.ticketNumber !== undefined ? String(Number(r.ticketNumber)) : null,
        title: r.title,
        status: r.status,
      }));
    } catch (err: any) {
      if (isMissingRelationError(err)) return [];
      throw err;
    }
  }

  private async resolveLinkedTicketId(linkedRefRaw: string, req: any): Promise<string> {
    const linkedRef = String(linkedRefRaw ?? "").trim();

    if (isUuid(linkedRef)) return linkedRef;

    const orgId = getOrgIdFromReq(req);
    if (!orgId) {
      throw new BadRequestException("Linking by ticket number requires organization context; provide a UUID instead.");
    }

    if (!isIntLike(linkedRef)) {
      throw new BadRequestException("linkedId must be a UUID or a numeric ticket number");
    }

    const num = Number(linkedRef);
    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException("Invalid ticket number");
    }

    const sql = `
      SELECT id::text AS id
      FROM tickets
      WHERE organization_id::text = $1 AND ticket_number = $2
      LIMIT 1;
    `;
    const { rows } = await this.db.query<{ id: string }>(sql, [orgId, num]);
    const r = rows[0];
    if (!r?.id) throw new NotFoundException("Linked ticket not found");
    return r.id;
  }

  async addLink(ticketId: string, linkedIdOrNumber: string, req: any) {
    const resolvedLinkedId = await this.resolveLinkedTicketId(linkedIdOrNumber, req);

    if (ticketId === resolvedLinkedId) throw new BadRequestException("Cannot link a ticket to itself");

    const a = await this.requireTicket(ticketId, req);
    const b = await this.requireTicket(resolvedLinkedId, req);

    if (a.orgId && b.orgId && a.orgId !== b.orgId) {
      throw new BadRequestException("Cannot link tickets across organizations");
    }

    try {
      const sqlWithId = `
        INSERT INTO ticket_links (id, ticket_id, linked_ticket_id)
        VALUES ($1::uuid, $2::uuid, $3::uuid)
        ON CONFLICT DO NOTHING;
      `;

      const sqlNoId = `
        INSERT INTO ticket_links (ticket_id, linked_ticket_id)
        VALUES ($1::uuid, $2::uuid)
        ON CONFLICT DO NOTHING;
      `;

      // Try schema with id column first; fallback if your table doesn't have it.
      try {
        await this.db.query(sqlWithId, [randomUUID(), ticketId, resolvedLinkedId]);
        await this.db.query(sqlWithId, [randomUUID(), resolvedLinkedId, ticketId]);
      } catch (err: any) {
        if (isUndefinedColumnError(err)) {
          await this.db.query(sqlNoId, [ticketId, resolvedLinkedId]);
          await this.db.query(sqlNoId, [resolvedLinkedId, ticketId]);
        } else {
          throw err;
        }
      }

      return { ok: true };
    } catch (err: any) {
      if (isMissingRelationError(err)) return { ok: true };
      throw err;
    }
  }
}
