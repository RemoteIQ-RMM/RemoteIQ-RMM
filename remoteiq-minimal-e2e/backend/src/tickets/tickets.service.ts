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

export type AttachmentItem = { id: string; name: string; size?: number; url: string };

export type MessageActivityItem = {
  id: string;
  kind: "message";
  author: string;
  body: string;
  createdAt: string;
  isInternal: false;
  attachments: AttachmentItem[];
};

export type NoteActivityItem = {
  id: string;
  kind: "note";
  author: string;
  body: string;
  createdAt: string;
  isInternal: true;
  attachments: AttachmentItem[];
};

export type ChangeActivityItem = {
  id: string;
  kind: "change";
  createdAt: string;
  actor: string;
  field: "status" | "priority" | "assignee" | "title" | "dueAt" | "collaborators";
  from?: string | null;
  to?: string | null;
};

export type ActivityItem = MessageActivityItem | NoteActivityItem | ChangeActivityItem;

export type ReplyItem = MessageActivityItem;
export type NoteItem = NoteActivityItem;

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

function normalizeAttachments(v: any): AttachmentItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a: any) => ({
      id: String(a?.id ?? randomUUID()),
      name: String(a?.name ?? ""),
      size: typeof a?.size === "number" ? a.size : undefined,
      url: String(a?.url ?? ""),
    }))
    .filter((a: AttachmentItem) => !!a.url);
}

@Injectable()
export class TicketsService {
  private ensured = false;

  constructor(private readonly db: PgPoolService) { }

  /**
   * Align ticket_activity schema to what your UI/backend expects.
   * (matches the columns you showed: body/time_worked_seconds/notify_customer are NOT NULL)
   */
  private async ensureTables() {
    if (this.ensured) return;

    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ticket_activity (
          id uuid PRIMARY KEY,
          ticket_id uuid NOT NULL,
          kind text NOT NULL,
          body text NOT NULL DEFAULT '',
          attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
          time_worked_seconds integer NOT NULL DEFAULT 0,
          notify_customer boolean NOT NULL DEFAULT false,
          author text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          is_internal boolean NOT NULL DEFAULT false,
          field text NULL,
          from_value text NULL,
          to_value text NULL
        );
      `);

      // If table existed from older revisions, add missing columns and set safe defaults.
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS body text;`);
      await this.db.query(`ALTER TABLE ticket_activity ALTER COLUMN body SET DEFAULT '';`);

      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS attachments jsonb;`);
      await this.db.query(`ALTER TABLE ticket_activity ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;`);

      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS time_worked_seconds integer;`);
      await this.db.query(`ALTER TABLE ticket_activity ALTER COLUMN time_worked_seconds SET DEFAULT 0;`);

      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS notify_customer boolean;`);
      await this.db.query(`ALTER TABLE ticket_activity ALTER COLUMN notify_customer SET DEFAULT false;`);

      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS is_internal boolean;`);
      await this.db.query(`ALTER TABLE ticket_activity ALTER COLUMN is_internal SET DEFAULT false;`);

      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS field text;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS from_value text;`);
      await this.db.query(`ALTER TABLE ticket_activity ADD COLUMN IF NOT EXISTS to_value text;`);

      await this.db.query(`
        CREATE INDEX IF NOT EXISTS ticket_activity_ticket_created_idx
        ON ticket_activity (ticket_id, created_at DESC);
      `);

      // ticket_links (best-effort)
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ticket_links (
          id uuid PRIMARY KEY,
          ticket_id uuid NOT NULL,
          linked_ticket_id uuid NOT NULL
        );
      `);

      await this.db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ticket_links_pair_uq
        ON ticket_links (ticket_id, linked_ticket_id);
      `);

      this.ensured = true;
    } catch {
      // Never hard-fail on ensure in case migrations are managed elsewhere.
      this.ensured = true;
    }
  }

  async list(
    q: ListTicketsQuery,
    req: any
  ): Promise<{ items: Ticket[]; page: number; pageSize: number; total: number }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 25), 200);
    const offset = (page - 1) * pageSize;

    const orgId = (q as any).organizationId ?? (q as any).customerId ?? getOrgIdFromReq(req);

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (orgId) {
      where.push(`t.organization_id::text = $${p++}`);
      params.push(orgId);
    }

    if ((q as any).status && STATUS_ALLOW.has((q as any).status)) {
      where.push(`t.status = $${p++}`);
      params.push((q as any).status);
    }

    if ((q as any).priority && PRIORITY_ALLOW.has(String((q as any).priority).toLowerCase())) {
      where.push(`t.priority = $${p++}`);
      params.push(priorityApiToDb(String((q as any).priority)));
    }

    if ((q as any).search) {
      where.push(`(
        t.subject ILIKE $${p}
        OR t.description ILIKE $${p}
        OR t.id::text ILIKE $${p}
        OR t.ticket_number::text ILIKE $${p}
      )`);
      params.push(`%${String((q as any).search).trim()}%`);
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
    const orgId = (dto as any).organizationId ?? (dto as any).customerId ?? getOrgIdFromReq(req);
    if (!orgId) {
      throw new BadRequestException("organizationId is required (not found in request session or payload)");
    }

    const title = String((dto as any).subject ?? (dto as any).title ?? "").trim();
    if (!title) throw new BadRequestException("subject/title is required");

    const status = String((dto as any).status ?? "open").toLowerCase() as Ticket["status"];
    const priorityApi = String((dto as any).priority ?? "medium").toLowerCase();

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
      (dto as any).description ?? null,
      status,
      priorityDb,
      (dto as any).assigneeUserId ?? null,
      (dto as any).requesterContactId ?? null,
      (dto as any).deviceId ?? null,
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
    await this.ensureTables();

    const changeBody = `${field}: ${from ?? "-"} -> ${to ?? "-"}`;

    try {
      await this.db.query(
        `
        INSERT INTO ticket_activity
          (id, ticket_id, kind, body, attachments, time_worked_seconds, notify_customer, author, is_internal, field, from_value, to_value)
        VALUES
          ($1::uuid, $2::uuid, 'change', $3, '[]'::jsonb, 0, false, $4, true, $5, $6, $7);
        `,
        [randomUUID(), ticketId, changeBody, actor, field, from, to]
      );
      return;
    } catch (err: any) {
      if (isUndefinedColumnError(err)) {
        try {
          await this.db.query(
            `
            INSERT INTO ticket_activity
              (id, ticket_id, kind, body, attachments, time_worked_seconds, notify_customer, author, is_internal)
            VALUES
              ($1::uuid, $2::uuid, 'change', $3, '[]'::jsonb, 0, false, $4, true);
            `,
            [randomUUID(), ticketId, changeBody, actor]
          );
          return;
        } catch {
          return;
        }
      }

      if (isMissingRelationError(err)) return;
      return;
    }
  }

  async update(id: string, dto: UpdateTicketDto, req: any): Promise<boolean> {
    const actor = getActorFromReq(req);
    const before = await this.requireTicket(id, req);

    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    const nextOrg = (dto as any).organizationId ?? (dto as any).customerId;
    if (nextOrg !== undefined) {
      sets.push(`organization_id = $${p++}`);
      params.push(nextOrg);
    }

    if ((dto as any).subject !== undefined || (dto as any).title !== undefined) {
      const nextTitle = String((dto as any).subject ?? (dto as any).title ?? "").trim();
      if (!nextTitle) throw new BadRequestException("subject/title cannot be empty");
      sets.push(`subject = $${p++}`);
      params.push(nextTitle);
    }

    if ((dto as any).description !== undefined) {
      sets.push(`description = $${p++}`);
      params.push((dto as any).description);
    }

    if ((dto as any).status !== undefined) {
      const s = String((dto as any).status).toLowerCase() as Ticket["status"];
      if (!STATUS_ALLOW.has(s)) throw new BadRequestException("Invalid status");
      sets.push(`status = $${p++}`);
      params.push(s);
    }

    if ((dto as any).priority !== undefined) {
      const pr = String((dto as any).priority).toLowerCase();
      if (!PRIORITY_ALLOW.has(pr)) throw new BadRequestException("Invalid priority");
      sets.push(`priority = $${p++}`);
      params.push(priorityApiToDb(pr));
    }

    if ((dto as any).assigneeUserId !== undefined) {
      sets.push(`assignee_user_id = $${p++}`);
      params.push((dto as any).assigneeUserId);
    }

    if ((dto as any).requesterContactId !== undefined) {
      sets.push(`requester_contact_id = $${p++}`);
      params.push((dto as any).requesterContactId);
    }

    if ((dto as any).deviceId !== undefined) {
      sets.push(`device_id = $${p++}`);
      params.push((dto as any).deviceId);
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
      if (beforeAssignee !== afterAssignee) await this.addChange(id, actor, "assignee", beforeAssignee || null, afterAssignee || null);

      const beforeDue = before.row.dueAt ? new Date(before.row.dueAt).toISOString() : null;
      const afterDue = after.row.dueAt ? new Date(after.row.dueAt).toISOString() : null;
      if ((beforeDue ?? null) !== (afterDue ?? null)) await this.addChange(id, actor, "dueAt", beforeDue, afterDue);
    } catch {
      // ignore
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
    await this.ensureTables();
    await this.requireTicket(ticketId, req);

    const actor = getActorFromReq(req);
    const body = String(payload?.body ?? "").trim();
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    const notify = kind === "message" ? !!payload?.notifyCustomer : false;

    try {
      await this.db.query(
        `
        INSERT INTO ticket_activity
          (id, ticket_id, kind, body, attachments, time_worked_seconds, notify_customer, author, is_internal)
        VALUES
          ($1::uuid, $2::uuid, $3, $4, $5::jsonb, 0, $6, $7, $8);
        `,
        [
          randomUUID(),
          ticketId,
          kind,
          body,
          JSON.stringify(attachments),
          notify,
          actor,
          kind === "note",
        ]
      );
    } catch (err: any) {
      if (isMissingRelationError(err)) return { ok: true };
      throw err;
    }

    return { ok: true };
  }

  /**
   * Replies (messages only). Newest first.
   */
  async getReplies(ticketId: string, req: any): Promise<ReplyItem[]> {
    await this.ensureTables();
    await this.requireTicket(ticketId, req);

    try {
      const { rows } = await this.db.query(
        `
        SELECT
          id::text as id,
          author,
          COALESCE(body,'') as body,
          created_at as "createdAt",
          attachments
        FROM ticket_activity
        WHERE ticket_id::text = $1 AND kind = 'message'
        ORDER BY created_at DESC;
        `,
        [ticketId]
      );

      const items: ReplyItem[] = (rows as any[]).map((r: any): ReplyItem => ({
        id: String(r.id),
        kind: "message",
        author: String(r.author ?? "System"),
        body: String(r.body ?? ""),
        createdAt: new Date(r.createdAt).toISOString(),
        isInternal: false,
        attachments: normalizeAttachments(r.attachments),
      }));

      return items;
    } catch (err: any) {
      if (isMissingRelationError(err)) return [];
      throw err;
    }
  }

  /**
   * Internal Notes (notes only). Newest first.
   */
  async getInternalNotes(ticketId: string, req: any): Promise<NoteItem[]> {
    await this.ensureTables();
    await this.requireTicket(ticketId, req);

    try {
      const { rows } = await this.db.query(
        `
        SELECT
          id::text as id,
          author,
          COALESCE(body,'') as body,
          created_at as "createdAt",
          attachments
        FROM ticket_activity
        WHERE ticket_id::text = $1 AND kind = 'note'
        ORDER BY created_at DESC;
        `,
        [ticketId]
      );

      const items: NoteItem[] = (rows as any[]).map((r: any): NoteItem => ({
        id: String(r.id),
        kind: "note",
        author: String(r.author ?? "System"),
        body: String(r.body ?? ""),
        createdAt: new Date(r.createdAt).toISOString(),
        isInternal: true,
        attachments: normalizeAttachments(r.attachments),
      }));

      return items;
    } catch (err: any) {
      if (isMissingRelationError(err)) return [];
      throw err;
    }
  }

  async getHistory(ticketId: string, req: any): Promise<{ at: string; who: string; what: string }[]> {
    await this.ensureTables();
    await this.requireTicket(ticketId, req);

    try {
      const { rows } = await this.db.query(
        `
        SELECT
          created_at as at,
          author as who,
          field,
          from_value as "fromValue",
          to_value as "toValue",
          body
        FROM ticket_activity
        WHERE ticket_id::text = $1 AND kind = 'change'
        ORDER BY created_at DESC
        LIMIT 100;
        `,
        [ticketId]
      );

      return (rows as any[]).map((r: any) => {
        const f = String(r.field ?? "").trim();
        if (f) {
          return {
            at: new Date(r.at).toISOString(),
            who: String(r.who ?? "System"),
            what: `${f}: ${r.fromValue ?? "-"} -> ${r.toValue ?? "-"}`,
          };
        }
        return {
          at: new Date(r.at).toISOString(),
          who: String(r.who ?? "System"),
          what: String(r.body ?? ""),
        };
      });
    } catch (err: any) {
      if (isMissingRelationError(err)) return [];
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

      const { rows } = await this.db.query(
        `
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
        `,
        params
      );

      return (rows as any[]).map((r: any) => ({
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

    const { rows } = await this.db.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM tickets
      WHERE organization_id::text = $1 AND ticket_number = $2
      LIMIT 1;
      `,
      [orgId, num]
    );
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
