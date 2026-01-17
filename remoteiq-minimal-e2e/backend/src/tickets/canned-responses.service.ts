import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { randomUUID } from "crypto";

export type AdminCannedResponse = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function getOrgIdFromReq(req: any): string | null {
  const u = req?.user ?? req?.auth ?? null;
  return u?.organizationId ?? u?.organization_id ?? u?.orgId ?? u?.org_id ?? null;
}

function normTitle(s: any): string {
  return String(s ?? "").trim();
}

function normBody(s: any): string {
  return String(s ?? "").trim();
}

function isPgUniqueViolation(err: any): boolean {
  return err?.code === "23505";
}

@Injectable()
export class CannedResponsesService {
  private ensured = false;

  constructor(private readonly db: PgPoolService) {}

  private async ensureTable() {
    if (this.ensured) return;

    // Create table + indexes if missing (idempotent)
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS canned_responses (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS canned_responses_org_idx
        ON canned_responses (organization_id);
    `);

    // Prevent duplicate titles per-org (case-insensitive)
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_org_title_uq
        ON canned_responses (organization_id, lower(title));
    `);

    this.ensured = true;
  }

  // Used by ticket composer: only ACTIVE responses, minimal shape
  async listForTicketUse(req: any): Promise<Array<{ id: string; title: string; body: string }>> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return [];

    await this.ensureTable();

    const { rows } = await this.db.query(
      `
      SELECT id::text AS id, title, body
      FROM canned_responses
      WHERE organization_id::text = $1 AND is_active = true
      ORDER BY lower(title) ASC;
      `,
      [orgId]
    );

    return rows.map((r: any) => ({ id: r.id, title: r.title, body: r.body }));
  }

  // Admin: list all responses (active + inactive)
  async adminList(req: any): Promise<AdminCannedResponse[]> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return [];

    await this.ensureTable();

    const { rows } = await this.db.query(
      `
      SELECT
        id::text AS id,
        title,
        body,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM canned_responses
      WHERE organization_id::text = $1
      ORDER BY lower(title) ASC;
      `,
      [orgId]
    );

    return rows.map((r: any) => ({
      id: r.id,
      title: String(r.title ?? ""),
      body: String(r.body ?? ""),
      isActive: !!r.isActive,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  async adminCreate(req: any, input: { title: string; body: string; isActive?: boolean }) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTable();

    const title = normTitle(input?.title);
    const body = normBody(input?.body);
    const isActive = input?.isActive !== false;

    if (!title) throw new BadRequestException("title is required");
    if (title.length > 200) throw new BadRequestException("title is too long (max 200)");
    if (!body) throw new BadRequestException("body is required");
    if (body.length > 20000) throw new BadRequestException("body is too long (max 20000)");

    const id = randomUUID();

    try {
      await this.db.query(
        `
        INSERT INTO canned_responses (id, organization_id, title, body, is_active, created_at, updated_at)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, now(), now());
        `,
        [id, orgId, title, body, isActive]
      );
    } catch (err: any) {
      if (isPgUniqueViolation(err)) {
        throw new BadRequestException("A canned response with that title already exists.");
      }
      throw err;
    }

    return { id };
  }

  async adminUpdate(req: any, id: string, input: { title?: string; body?: string; isActive?: boolean }) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTable();

    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (input.title !== undefined) {
      const title = normTitle(input.title);
      if (!title) throw new BadRequestException("title cannot be empty");
      if (title.length > 200) throw new BadRequestException("title is too long (max 200)");
      sets.push(`title = $${p++}`);
      params.push(title);
    }

    if (input.body !== undefined) {
      const body = normBody(input.body);
      if (!body) throw new BadRequestException("body cannot be empty");
      if (body.length > 20000) throw new BadRequestException("body is too long (max 20000)");
      sets.push(`body = $${p++}`);
      params.push(body);
    }

    if (input.isActive !== undefined) {
      sets.push(`is_active = $${p++}`);
      params.push(!!input.isActive);
    }

    if (sets.length === 0) return { ok: true };

    sets.push(`updated_at = now()`);

    // where clause
    params.push(id);
    params.push(orgId);

    try {
      const { rowCount } = await this.db.query(
        `
        UPDATE canned_responses
        SET ${sets.join(", ")}
        WHERE id::text = $${p++} AND organization_id::text = $${p++};
        `,
        params
      );

      if (!rowCount) throw new NotFoundException("Canned response not found");
    } catch (err: any) {
      if (isPgUniqueViolation(err)) {
        throw new BadRequestException("A canned response with that title already exists.");
      }
      throw err;
    }

    return { ok: true };
  }

  async adminDelete(req: any, id: string) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTable();

    const { rowCount } = await this.db.query(
      `
      DELETE FROM canned_responses
      WHERE id::text = $1 AND organization_id::text = $2;
      `,
      [id, orgId]
    );

    if (!rowCount) throw new NotFoundException("Canned response not found");
    return { ok: true };
  }
}
