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

export type AdminCannedVariable = {
  id: string;
  key: string;
  value: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VariableDefinition = {
  key: string; // e.g. "ticket.number", "now.datetime", "company.name", "custom.companyName"
  label: string;
  description?: string;
  source: "preset" | "custom";
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

function normKey(s: any): string {
  return String(s ?? "").trim();
}

function isPgUniqueViolation(err: any): boolean {
  return err?.code === "23505";
}

function isMissingRelationError(err: any): boolean {
  return err?.code === "42P01";
}

function isUndefinedColumnError(err: any): boolean {
  return err?.code === "42703";
}

function safeStr(v: any): string {
  return String(v ?? "").trim();
}

function renderTemplate(template: string, ctx: Record<string, string>): string {
  const src = String(template ?? "");
  return src.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, rawKey) => {
    const key = String(rawKey ?? "").trim();
    const v = ctx[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

@Injectable()
export class CannedResponsesService {
  private ensured = false;

  constructor(private readonly db: PgPoolService) {}

  private presetDefs(): VariableDefinition[] {
    return [
      // Ticket
      { key: "ticket.id", label: "Ticket UUID", description: "Full ticket UUID.", source: "preset" },
      { key: "ticket.uuid", label: "Ticket UUID (alias)", description: "Alias of ticket.id.", source: "preset" },
      { key: "ticket.number", label: "Ticket number", description: "Numeric ticket number (if available).", source: "preset" },
      { key: "ticket.title", label: "Ticket title", description: "Ticket subject/title.", source: "preset" },
      { key: "ticket.status", label: "Ticket status", description: "open / in_progress / resolved / closed.", source: "preset" },
      { key: "ticket.priority", label: "Ticket priority", description: "low / medium / high / urgent.", source: "preset" },
      { key: "ticket.dueAt", label: "Due date/time", description: "Due date in America/New_York (if set).", source: "preset" },

      // People
      { key: "requester.name", label: "Requester name", description: "Best-effort: contact/user name when available.", source: "preset" },
      { key: "requester.email", label: "Requester email", description: "Best-effort when available.", source: "preset" },
      { key: "assignee.name", label: "Assignee name", description: "Best-effort from users table.", source: "preset" },
      { key: "assignee.email", label: "Assignee email", description: "Best-effort from users table.", source: "preset" },

      // Time
      { key: "now.iso", label: "Current time (ISO)", description: "Server time as ISO string.", source: "preset" },
      { key: "now.date", label: "Current date", description: "Date in America/New_York.", source: "preset" },
      { key: "now.time", label: "Current time", description: "Time in America/New_York.", source: "preset" },
      { key: "now.datetime", label: "Current date/time", description: "Date+time in America/New_York.", source: "preset" },

      // Company (your schema: company_profile id=1)
      { key: "company.name", label: "Company name", description: "Company profile name.", source: "preset" },
      { key: "company.legalName", label: "Legal name", description: "Company legal name.", source: "preset" },
      { key: "company.email", label: "Company email", description: "Company contact email.", source: "preset" },
      { key: "company.phone", label: "Company phone", description: "Company phone number.", source: "preset" },
      { key: "company.fax", label: "Company fax", description: "Company fax number.", source: "preset" },
      { key: "company.website", label: "Company website", description: "Company website.", source: "preset" },
      { key: "company.vatTin", label: "VAT/TIN", description: "Company VAT/TIN.", source: "preset" },
      { key: "company.address1", label: "Address line 1", description: "Company address line 1.", source: "preset" },
      { key: "company.address2", label: "Address line 2", description: "Company address line 2.", source: "preset" },
      { key: "company.city", label: "City", description: "Company city.", source: "preset" },
      { key: "company.state", label: "State", description: "Company state/province.", source: "preset" },
      { key: "company.postal", label: "Postal", description: "Company postal/zip.", source: "preset" },
      { key: "company.country", label: "Country", description: "Company country.", source: "preset" },

      // Branding (optional best-effort)
      { key: "branding.primaryColor", label: "Branding primary color", description: "Primary color.", source: "preset" },
      { key: "branding.secondaryColor", label: "Branding secondary color", description: "Secondary color.", source: "preset" },
      { key: "branding.logoUrl", label: "Brand logo URL", description: "Best-effort logo url.", source: "preset" },
      { key: "branding.emailHeader", label: "Email header", description: "Brand email header content.", source: "preset" },
      { key: "branding.emailFooter", label: "Email footer", description: "Brand email footer content.", source: "preset" },
    ];
  }

  private async ensureTables() {
    if (this.ensured) return;

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

    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_org_title_uq
        ON canned_responses (organization_id, lower(title));
    `);

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS canned_variables (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        key text NOT NULL,
        value text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS canned_variables_org_idx
        ON canned_variables (organization_id);
    `);

    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS canned_variables_org_key_uq
        ON canned_variables (organization_id, lower(key));
    `);

    this.ensured = true;
  }

  // ---------------- Ticket-side canned list ----------------

  async listForTicketUse(req: any): Promise<Array<{ id: string; title: string; body: string }>> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return [];

    await this.ensureTables();

    const { rows } = await this.db.query(
      `
      SELECT id::text AS id, title, body
      FROM canned_responses
      WHERE organization_id::text = $1 AND is_active = true
      ORDER BY lower(title) ASC;
      `,
      [orgId],
    );

    return rows.map((r: any) => ({ id: r.id, title: r.title, body: r.body }));
  }

  async listVariableDefinitionsForTicketUse(req: any): Promise<VariableDefinition[]> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return this.presetDefs();

    await this.ensureTables();

    const defs: VariableDefinition[] = [...this.presetDefs()];

    const { rows } = await this.db.query(
      `
      SELECT key, is_active
      FROM canned_variables
      WHERE organization_id::text = $1 AND is_active = true
      ORDER BY lower(key) ASC;
      `,
      [orgId],
    );

    for (const r of rows as any[]) {
      const k = String(r?.key ?? "").trim();
      if (!k) continue;
      defs.push({
        key: `custom.${k}`,
        label: `Custom: ${k}`,
        description: "Admin-defined variable.",
        source: "custom",
      });
    }

    return defs;
  }

  async listVariableValuesForTicket(ticketId: string, req: any): Promise<Array<{ key: string; value: string }>> {
    const ctx = await this.buildContextForTicket(ticketId, req);
    const keys = Object.keys(ctx).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ key: k, value: ctx[k] }));
  }

  async renderForTicket(ticketId: string, template: string, req: any): Promise<string> {
    const ctx = await this.buildContextForTicket(ticketId, req);
    return renderTemplate(template, ctx);
  }

  private emptyCompanyContext(): Record<string, string> {
    return {
      "company.name": "",
      "company.legalName": "",
      "company.email": "",
      "company.phone": "",
      "company.fax": "",
      "company.website": "",
      "company.vatTin": "",
      "company.address1": "",
      "company.address2": "",
      "company.city": "",
      "company.state": "",
      "company.postal": "",
      "company.country": "",
    };
  }

  private async loadCompanyProfileRowId1(): Promise<Record<string, string>> {
    const out = this.emptyCompanyContext();

    try {
      // Match CompanyService.get(): company_profile WHERE id = 1
      const { rows } = await this.db.query(
        `
        SELECT
          id,
          name,
          legal_name AS "legalName",
          email, phone, fax, website,
          vat_tin AS "vatTin",
          address1, address2, city, state, postal, country
        FROM company_profile
        WHERE id = $1
        LIMIT 1;
        `,
        [1],
      );

      const r = (rows as any[])[0];
      if (!r) return out;

      out["company.name"] = safeStr(r?.name);
      out["company.legalName"] = safeStr(r?.legalName);
      out["company.email"] = safeStr(r?.email);
      out["company.phone"] = safeStr(r?.phone);
      out["company.fax"] = safeStr(r?.fax);
      out["company.website"] = safeStr(r?.website);
      out["company.vatTin"] = safeStr(r?.vatTin);
      out["company.address1"] = safeStr(r?.address1);
      out["company.address2"] = safeStr(r?.address2);
      out["company.city"] = safeStr(r?.city);
      out["company.state"] = safeStr(r?.state);
      out["company.postal"] = safeStr(r?.postal);
      out["company.country"] = safeStr(r?.country);

      return out;
    } catch (err: any) {
      // company_profile might not exist in some envs; never fail canned rendering
      if (isMissingRelationError(err) || isUndefinedColumnError(err)) return out;
      return out;
    }
  }

  private async bestEffortBranding(orgId: string | null): Promise<Record<string, string>> {
    const out: Record<string, string> = {
      "branding.primaryColor": "",
      "branding.secondaryColor": "",
      "branding.logoUrl": "",
      "branding.emailHeader": "",
      "branding.emailFooter": "",
    };

    const queries: Array<{ sql: string; params: any[] }> = [
      // Your described schema: branding_settings id=1
      {
        sql: `
          SELECT
            primary_color AS "primaryColor",
            secondary_color AS "secondaryColor",
            logo_light_url AS "logoLightUrl",
            logo_dark_url AS "logoDarkUrl",
            email_header AS "emailHeader",
            email_footer AS "emailFooter"
          FROM branding_settings
          WHERE id = 1
          LIMIT 1;
        `,
        params: [],
      },
      // org-scoped variant (if you later add it)
      ...(orgId
        ? [
            {
              sql: `
                SELECT
                  primary_color AS "primaryColor",
                  secondary_color AS "secondaryColor",
                  logo_light_url AS "logoLightUrl",
                  logo_dark_url AS "logoDarkUrl",
                  email_header AS "emailHeader",
                  email_footer AS "emailFooter"
                FROM branding_settings
                WHERE organization_id::text = $1
                LIMIT 1;
              `,
              params: [orgId],
            },
          ]
        : []),
    ];

    for (const q of queries) {
      try {
        const { rows } = await this.db.query(q.sql, q.params);
        const r = (rows as any[])[0];
        if (!r) continue;

        out["branding.primaryColor"] = safeStr(r?.primaryColor);
        out["branding.secondaryColor"] = safeStr(r?.secondaryColor);
        out["branding.emailHeader"] = safeStr(r?.emailHeader);
        out["branding.emailFooter"] = safeStr(r?.emailFooter);

        const logo = safeStr(r?.logoLightUrl) || safeStr(r?.logoDarkUrl);
        out["branding.logoUrl"] = logo;

        const got = Object.values(out).some((v) => !!String(v ?? "").trim());
        if (got) break;
      } catch (err: any) {
        if (isMissingRelationError(err) || isUndefinedColumnError(err)) continue;
        break;
      }
    }

    return out;
  }

  private async buildContextForTicket(ticketId: string, req: any): Promise<Record<string, string>> {
    const orgIdFromReq = getOrgIdFromReq(req);

    await this.ensureTables();

    // ---- load ticket (enforce org if present) ----
    const params: any[] = [ticketId];
    let orgWhere = "";
    if (orgIdFromReq) {
      params.push(orgIdFromReq);
      orgWhere = "AND organization_id::text = $2";
    }

    const { rows: tRows } = await this.db.query(
      `
      SELECT
        id::text as id,
        organization_id::text as "organizationId",
        ticket_number::bigint as "ticketNumber",
        subject as title,
        status,
        priority,
        due_at as "dueAt",
        requester_contact_id::text as "requesterContactId",
        assignee_user_id::text as "assigneeUserId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM tickets
      WHERE id::text = $1
      ${orgWhere}
      LIMIT 1;
      `,
      params,
    );

    const t = (tRows as any[])[0];
    if (!t) throw new NotFoundException("Ticket not found");

    const orgId = String(t.organizationId ?? "").trim() || null;
    const tz = "America/New_York";
    const now = new Date();

    const ctx: Record<string, string> = {
      "ticket.id": safeStr(t.id),
      "ticket.uuid": safeStr(t.id),
      "ticket.number": t.ticketNumber !== null && t.ticketNumber !== undefined ? String(Number(t.ticketNumber)) : "",
      "ticket.title": safeStr(t.title),
      "ticket.status": safeStr(t.status),
      "ticket.priority": safeStr(t.priority),
      "ticket.dueAt": t.dueAt ? new Date(t.dueAt).toLocaleString("en-US", { timeZone: tz }) : "",

      "now.iso": now.toISOString(),
      "now.date": now.toLocaleDateString("en-US", { timeZone: tz }),
      "now.time": now.toLocaleTimeString("en-US", { timeZone: tz }),
      "now.datetime": now.toLocaleString("en-US", { timeZone: tz }),

      // initialize these so templates never crash
      ...this.emptyCompanyContext(),
      "branding.primaryColor": "",
      "branding.secondaryColor": "",
      "branding.logoUrl": "",
      "branding.emailHeader": "",
      "branding.emailFooter": "",
      "requester.name": "",
      "requester.email": "",
      "assignee.name": "",
      "assignee.email": "",
    };

    // ---- company profile (FIX: matches your CompanyService: id=1) ----
    Object.assign(ctx, await this.loadCompanyProfileRowId1());

    // ---- branding (optional) ----
    Object.assign(ctx, await this.bestEffortBranding(orgId));

    // ---- assignee best-effort (users table) ----
    const assigneeId = safeStr(t.assigneeUserId);
    if (assigneeId) {
      try {
        const { rows: uRows } = await this.db.query(`SELECT name, email FROM users WHERE id::text = $1 LIMIT 1;`, [
          assigneeId,
        ]);
        const u = (uRows as any[])[0];
        ctx["assignee.name"] = safeStr(u?.name);
        ctx["assignee.email"] = safeStr(u?.email);
      } catch (err: any) {
        if (!isMissingRelationError(err) && !isUndefinedColumnError(err)) {
          // ignore best-effort errors
        }
      }
    }

    // ---- requester best-effort (contacts table) ----
    const requesterContactId = safeStr(t.requesterContactId);
    if (requesterContactId) {
      const tries = [
        { table: "contacts", nameCol: "name", emailCol: "email" },
        { table: "customer_contacts", nameCol: "name", emailCol: "email" },
      ];

      for (const tr of tries) {
        try {
          const { rows: cRows } = await this.db.query(
            `SELECT ${tr.nameCol} as name, ${tr.emailCol} as email FROM ${tr.table} WHERE id::text = $1 LIMIT 1;`,
            [requesterContactId],
          );
          const c = (cRows as any[])[0];
          if (c) {
            ctx["requester.name"] = safeStr(c?.name);
            ctx["requester.email"] = safeStr(c?.email);
            break;
          }
        } catch (err: any) {
          if (isMissingRelationError(err) || isUndefinedColumnError(err)) continue;
          break;
        }
      }
    }

    // ---- custom variables (active only) ----
    if (orgId) {
      try {
        const { rows: vRows } = await this.db.query(
          `
          SELECT key, value
          FROM canned_variables
          WHERE organization_id::text = $1 AND is_active = true
          ORDER BY lower(key) ASC;
          `,
          [orgId],
        );

        for (const r of vRows as any[]) {
          const k = String(r?.key ?? "").trim();
          const v = String(r?.value ?? "");
          if (!k) continue;

          ctx[`custom.${k}`] = v;
          ctx[`var.${k}`] = v;

          // convenience: allow {{companyName}} if it doesn't collide
          if (!k.includes(".") && ctx[k] === undefined) ctx[k] = v;
        }
      } catch {
        // ignore
      }
    }

    return ctx;
  }

  // ---------------- Admin canned responses CRUD ----------------

  async adminList(req: any): Promise<AdminCannedResponse[]> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return [];

    await this.ensureTables();

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
      [orgId],
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

    await this.ensureTables();

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
        [id, orgId, title, body, isActive],
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

    await this.ensureTables();

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

    params.push(id);
    params.push(orgId);

    try {
      const { rowCount } = await this.db.query(
        `
        UPDATE canned_responses
        SET ${sets.join(", ")}
        WHERE id::text = $${p++} AND organization_id::text = $${p++};
        `,
        params,
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

    await this.ensureTables();

    const { rowCount } = await this.db.query(
      `
      DELETE FROM canned_responses
      WHERE id::text = $1 AND organization_id::text = $2;
      `,
      [id, orgId],
    );

    if (!rowCount) throw new NotFoundException("Canned response not found");
    return { ok: true };
  }

  // ---------------- Admin variables CRUD ----------------

  async adminListVariables(req: any): Promise<AdminCannedVariable[]> {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) return [];

    await this.ensureTables();

    const { rows } = await this.db.query(
      `
      SELECT
        id::text AS id,
        key,
        value,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM canned_variables
      WHERE organization_id::text = $1
      ORDER BY lower(key) ASC;
      `,
      [orgId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      key: String(r.key ?? ""),
      value: String(r.value ?? ""),
      isActive: !!r.isActive,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  private validateVariableKey(keyRaw: string) {
    const k = normKey(keyRaw);
    if (!k) throw new BadRequestException("key is required");
    if (k.length > 80) throw new BadRequestException("key is too long (max 80)");
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(k)) {
      throw new BadRequestException("key must match: ^[a-zA-Z][a-zA-Z0-9_-]*$");
    }
    return k;
  }

  async adminCreateVariable(req: any, input: { key: string; value: string; isActive?: boolean }) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTables();

    const key = this.validateVariableKey(input?.key);
    const value = normBody(input?.value);
    const isActive = input?.isActive !== false;

    if (!value) throw new BadRequestException("value is required");
    if (value.length > 20000) throw new BadRequestException("value is too long (max 20000)");

    const id = randomUUID();

    try {
      await this.db.query(
        `
        INSERT INTO canned_variables (id, organization_id, key, value, is_active, created_at, updated_at)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, now(), now());
        `,
        [id, orgId, key, value, isActive],
      );
    } catch (err: any) {
      if (isPgUniqueViolation(err)) {
        throw new BadRequestException("A variable with that key already exists.");
      }
      throw err;
    }

    return { id };
  }

  async adminUpdateVariable(req: any, id: string, input: { key?: string; value?: string; isActive?: boolean }) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTables();

    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (input.key !== undefined) {
      const key = this.validateVariableKey(input.key);
      sets.push(`key = $${p++}`);
      params.push(key);
    }

    if (input.value !== undefined) {
      const value = normBody(input.value);
      if (!value) throw new BadRequestException("value cannot be empty");
      if (value.length > 20000) throw new BadRequestException("value is too long (max 20000)");
      sets.push(`value = $${p++}`);
      params.push(value);
    }

    if (input.isActive !== undefined) {
      sets.push(`is_active = $${p++}`);
      params.push(!!input.isActive);
    }

    if (sets.length === 0) return { ok: true };

    sets.push(`updated_at = now()`);

    params.push(id);
    params.push(orgId);

    try {
      const { rowCount } = await this.db.query(
        `
        UPDATE canned_variables
        SET ${sets.join(", ")}
        WHERE id::text = $${p++} AND organization_id::text = $${p++};
        `,
        params,
      );

      if (!rowCount) throw new NotFoundException("Variable not found");
    } catch (err: any) {
      if (isPgUniqueViolation(err)) {
        throw new BadRequestException("A variable with that key already exists.");
      }
      throw err;
    }

    return { ok: true };
  }

  async adminDeleteVariable(req: any, id: string) {
    const orgId = getOrgIdFromReq(req);
    if (!orgId) throw new BadRequestException("No organization context available");

    await this.ensureTables();

    const { rowCount } = await this.db.query(
      `
      DELETE FROM canned_variables
      WHERE id::text = $1 AND organization_id::text = $2;
      `,
      [id, orgId],
    );

    if (!rowCount) throw new NotFoundException("Variable not found");
    return { ok: true };
  }
}
