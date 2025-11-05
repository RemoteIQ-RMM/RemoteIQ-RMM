import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { ListTicketsQuery } from "./dto/list-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";

export type Ticket = {
  id: string;
  customerId: string | null;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  assigneeUserId: string | null;
  requesterEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_ALLOW = new Set(["open", "in_progress", "resolved", "closed"]);
const PRIORITY_ALLOW = new Set(["low", "medium", "high", "urgent"]);

@Injectable()
export class TicketsService {
  constructor(private readonly db: PgPoolService) {}

  async list(q: ListTicketsQuery): Promise<{
    items: Ticket[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 25), 200);
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (q.customerId) {
      where.push(`t.customer_id::text = $${p++}`);
      params.push(q.customerId);
    }
    if (q.status && STATUS_ALLOW.has(q.status)) {
      where.push(`t.status = $${p++}`);
      params.push(q.status);
    }
    if (q.priority && PRIORITY_ALLOW.has(q.priority)) {
      where.push(`t.priority = $${p++}`);
      params.push(q.priority);
    }
    if (q.search) {
      where.push(`(t.title ILIKE $${p} OR t.description ILIKE $${p})`);
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
        t.id::text                AS id,
        t.customer_id::text       AS "customerId",
        t.title                   AS title,
        NULLIF(t.description,'')  AS description,
        t.status                  AS status,
        t.priority                AS priority,
        t.assignee_user_id::text  AS "assigneeUserId",
        NULLIF(t.requester_email,'') AS "requesterEmail",
        t.created_at              AS "createdAt",
        t.updated_at              AS "updatedAt"
      FROM tickets t
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset};
    `;
    const { rows } = await this.db.query(listSql, params);

    const items = rows.map((r: any) => ({
      id: r.id,
      customerId: r.customerId ?? null,
      title: r.title,
      description: r.description ?? null,
      status: r.status,
      priority: r.priority,
      assigneeUserId: r.assigneeUserId ?? null,
      requesterEmail: r.requesterEmail ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    })) as Ticket[];

    return { items, page, pageSize, total };
  }

  async getOne(id: string): Promise<Ticket | null> {
    const sql = `
      SELECT
        t.id::text                AS id,
        t.customer_id::text       AS "customerId",
        t.title                   AS title,
        NULLIF(t.description,'')  AS description,
        t.status                  AS status,
        t.priority                AS priority,
        t.assignee_user_id::text  AS "assigneeUserId",
        NULLIF(t.requester_email,'') AS "requesterEmail",
        t.created_at              AS "createdAt",
        t.updated_at              AS "updatedAt"
      FROM tickets t
      WHERE t.id::text = $1
      LIMIT 1;
    `;
    const { rows } = await this.db.query(sql, [id]);
    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      customerId: r.customerId ?? null,
      title: r.title,
      description: r.description ?? null,
      status: r.status,
      priority: r.priority,
      assigneeUserId: r.assigneeUserId ?? null,
      requesterEmail: r.requesterEmail ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }

  async create(dto: CreateTicketDto): Promise<string> {
    const status = (dto.status ?? "open").toLowerCase();
    const priority = (dto.priority ?? "medium").toLowerCase();
    if (!STATUS_ALLOW.has(status)) throw new Error("Invalid status");
    if (!PRIORITY_ALLOW.has(priority)) throw new Error("Invalid priority");

    const sql = `
      INSERT INTO tickets
        (customer_id, title, description, status, priority, assignee_user_id, requester_email, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, now(), now())
      RETURNING id::text AS id;
    `;
    const params = [
      dto.customerId ?? null,
      dto.title,
      dto.description ?? null,
      status,
      priority,
      dto.assigneeUserId ?? null,
      dto.requesterEmail ?? null,
    ];
    const { rows } = await this.db.query<{ id: string }>(sql, params);
    return rows[0].id;
  }

  async update(id: string, dto: UpdateTicketDto): Promise<boolean> {
    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (dto.customerId !== undefined) {
      sets.push(`customer_id = $${p++}`);
      params.push(dto.customerId);
    }
    if (dto.title !== undefined) {
      sets.push(`title = $${p++}`);
      params.push(dto.title);
    }
    if (dto.description !== undefined) {
      sets.push(`description = $${p++}`);
      params.push(dto.description);
    }
    if (dto.status !== undefined) {
      const s = dto.status.toLowerCase();
      if (!STATUS_ALLOW.has(s)) throw new Error("Invalid status");
      sets.push(`status = $${p++}`);
      params.push(s);
    }
    if (dto.priority !== undefined) {
      const pr = dto.priority.toLowerCase();
      if (!PRIORITY_ALLOW.has(pr)) throw new Error("Invalid priority");
      sets.push(`priority = $${p++}`);
      params.push(pr);
    }
    if (dto.assigneeUserId !== undefined) {
      sets.push(`assignee_user_id = $${p++}`);
      params.push(dto.assigneeUserId);
    }
    if (dto.requesterEmail !== undefined) {
      sets.push(`requester_email = $${p++}`);
      params.push(dto.requesterEmail);
    }

    if (sets.length === 0) return true;

    sets.push(`updated_at = now()`);

    const sql = `
      UPDATE tickets
      SET ${sets.join(", ")}
      WHERE id::text = $${p}
    `;
    params.push(id);
    await this.db.query(sql, params);

    const exists = await this.getOne(id);
    return !!exists;
  }
}
