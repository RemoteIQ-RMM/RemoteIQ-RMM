// backend/src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PgPoolService } from "../storage/pg-pool.service";

function newOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type EnrollInput = {
  enrollmentSecret?: string; // one-time device-scoped token
  enrollmentKey?: string; // reusable site-scoped key
  deviceId: string; // uuid string
  hostname: string;
  os: string;
  arch: string;
  version: string;
};

type EnrollmentRow = {
  device_id: string;
  site_id: string;
  client_id: string;
  os: string;
  alias: string;
  expires_at: string;
};

type SiteKeyRow = {
  site_id: string;
  client_id: string;
  name: string | null;
  expires_at: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly pg: PgPoolService) { }

  /** Accept either enrollmentSecret (one-time) or enrollmentKey (reusable). */
  private getEnrollmentToken(input: EnrollInput): string {
    return String(input.enrollmentSecret ?? input.enrollmentKey ?? "").trim();
  }

  private async tryConsumeOneTimeEnrollment(
    input: EnrollInput
  ): Promise<EnrollmentRow | null> {
    const token = this.getEnrollmentToken(input);
    if (!token) return null;

    const tokenHash = hashToken(token);

    const { rows } = await this.pg.query<EnrollmentRow>(
      `
      SELECT
        e.device_id::text  AS device_id,
        e.site_id::text    AS site_id,
        e.client_id::text  AS client_id,
        e.os::text         AS os,
        e.alias::text      AS alias,
        e.expires_at::text AS expires_at
      FROM public.endpoint_enrollments e
      WHERE e.token_hash = $1
        AND e.used_at IS NULL
        AND e.expires_at > NOW()
      LIMIT 1
      `,
      [tokenHash]
    );

    const found = rows[0];
    if (!found) return null;

    // Enforce deviceId match for ONE-TIME tokens
    if (String(found.device_id) !== String(input.deviceId)) {
      throw new UnauthorizedException("Enrollment token does not match deviceId");
    }

    await this.pg.query(
      `
      UPDATE public.endpoint_enrollments
      SET used_at = NOW(), updated_at = NOW()
      WHERE token_hash = $1
        AND used_at IS NULL
      `,
      [tokenHash]
    );

    return found;
  }

  /**
   * Reusable enrollment key path:
   * - Token is NOT consumed.
   * - It only maps to (client_id, site_id) and must be unrevoked + unexpired.
   */
  private async tryUseReusableEnrollmentKey(
    input: EnrollInput
  ): Promise<SiteKeyRow | null> {
    const token = this.getEnrollmentToken(input);
    if (!token) return null;

    const tokenHash = hashToken(token);

    const { rows } = await this.pg.query<SiteKeyRow>(
      `
      SELECT
        k.site_id::text    AS site_id,
        k.client_id::text  AS client_id,
        k.name::text       AS name,
        k.expires_at::text AS expires_at
      FROM public.site_enrollment_keys k
      WHERE k.token_hash = $1
        AND k.revoked_at IS NULL
        AND k.expires_at > NOW()
      LIMIT 1
      `,
      [tokenHash]
    );

    const found = rows[0];
    if (!found) return null;

    // bump last_used_at (best-effort)
    this.pg
      .query(
        `
        UPDATE public.site_enrollment_keys
           SET last_used_at = NOW(),
               updated_at = NOW()
         WHERE token_hash = $1
        `,
        [tokenHash]
      )
      .catch(() => { });

    return found;
  }

  private async ensureDeviceRow(params: {
    deviceId: string;
    siteId?: string | null;
    alias?: string | null;
    hostname?: string | null;
    os?: string | null;
    arch?: string | null;
  }) {
    const deviceId = String(params.deviceId).trim();
    if (!deviceId) throw new BadRequestException("deviceId is required");

    await this.pg.query(
      `
      INSERT INTO public.devices (id, site_id, hostname, alias, operating_system, architecture, status, last_seen_at, created_at, updated_at)
      VALUES (
        $1::uuid,
        $2::uuid,
        COALESCE(NULLIF($3::text, ''), 'unknown'),
        NULLIF($4::text, ''),
        NULLIF($5::text, ''),
        NULLIF($6::text, ''),
        'online'::device_status,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        site_id          = COALESCE(EXCLUDED.site_id, public.devices.site_id),
        hostname         = COALESCE(NULLIF(EXCLUDED.hostname, ''), public.devices.hostname),
        alias            = COALESCE(NULLIF(EXCLUDED.alias, ''), public.devices.alias),
        operating_system = COALESCE(NULLIF(EXCLUDED.operating_system, ''), public.devices.operating_system),
        architecture     = COALESCE(NULLIF(EXCLUDED.architecture, ''), public.devices.architecture),
        last_seen_at     = NOW(),
        updated_at       = NOW()
      `,
      [
        deviceId,
        params.siteId ?? null,
        params.hostname ?? null,
        params.alias ?? null,
        params.os ?? null,
        params.arch ?? null,
      ]
    );
  }

  async enrollAgent(input: EnrollInput): Promise<{
    agentId: string;
    agentToken: string;
    deviceId: string;
    agentUuid: string | null;
  }> {
    // 1) Preferred: one-time expiring per-device token, else reusable site key
    let oneTime: EnrollmentRow | null = null;
    let siteKey: SiteKeyRow | null = null;

    oneTime = await this.tryConsumeOneTimeEnrollment(input);
    if (!oneTime) siteKey = await this.tryUseReusableEnrollmentKey(input);

    // 2) Legacy dev fallback (optional)
    if (!oneTime && !siteKey) {
      const expected = process.env.ENROLLMENT_SECRET || "";
      const provided = this.getEnrollmentToken(input);
      if (!expected || provided !== expected) {
        throw new UnauthorizedException("Invalid enrollment secret");
      }
    }

    try {
      const token = newOpaqueToken();
      const tokenHash = hashToken(token);

      const factsPatch: Record<string, any> = {};
      if (input.os) factsPatch.os = input.os;
      if (input.arch) factsPatch.arch = input.arch;

      // Determine target site + alias for device row
      const effectiveSiteId = oneTime?.site_id ?? siteKey?.site_id ?? null;

      // For reusable key enrollments, set alias to hostname by default
      const effectiveAlias =
        oneTime?.alias ??
        (input.hostname ? String(input.hostname).trim() : null) ??
        null;

      await this.ensureDeviceRow({
        deviceId: input.deviceId,
        siteId: effectiveSiteId,
        alias: effectiveAlias,
        hostname: input.hostname ?? null,
        os: (input.os ?? oneTime?.os ?? null) as any,
        arch: input.arch ?? null,
      });

      // Re-enroll if agent already exists for this device
      const existing = await this.pg.query<{
        id: string;
        agent_uuid: string | null;
      }>(
        `SELECT id::text AS id, agent_uuid
           FROM public.agents
          WHERE device_id = $1::uuid
          LIMIT 1`,
        [input.deviceId]
      );

      if (existing.rows[0]) {
        const agentId = existing.rows[0].id;

        const { rows } = await this.pg.query<{
          id: string;
          device_id: string;
          agent_uuid: string | null;
        }>(
          `
          UPDATE public.agents
             SET hostname         = $2,
                 version          = $3,
                 last_check_in_at = NOW(),
                 facts            = COALESCE(facts, '{}'::jsonb) || $4::jsonb,
                 agent_token      = $5,
                 token            = $5,
                 updated_at       = NOW(),
                 agent_uuid       = COALESCE(NULLIF(agent_uuid, ''), id::text)
           WHERE id = $1::uuid
           RETURNING id::text AS id, device_id::text AS device_id, agent_uuid
          `,
          [agentId, input.hostname, input.version, JSON.stringify(factsPatch), token]
        );

        const out = rows[0];
        this.logger.log(`Re-enrolled agent ${out.id} (deviceId=${out.device_id}).`);

        return {
          agentId: out.id,
          agentToken: token,
          deviceId: out.device_id,
          agentUuid: out.agent_uuid ?? out.id,
        };
      }

      const newId = randomUUID();

      const { rows } = await this.pg.query<{
        id: string;
        device_id: string;
        agent_uuid: string | null;
      }>(
        `
        INSERT INTO public.agents
          (id, device_id, agent_uuid, hostname, version, last_check_in_at, facts, agent_token, token, created_at, updated_at)
        VALUES
          ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, NOW(), $6::jsonb, $7::text, $7::text, NOW(), NOW())
        RETURNING id::text AS id, device_id::text AS device_id, agent_uuid
        `,
        [newId, input.deviceId, newId, input.hostname, input.version, JSON.stringify(factsPatch), token]
      );

      const out = rows[0];
      this.logger.log(
        `Enrolled new agent ${out.id} (deviceId=${out.device_id}). tokenHash=${tokenHash}`
      );

      return {
        agentId: out.id,
        agentToken: token,
        deviceId: out.device_id,
        agentUuid: out.agent_uuid ?? out.id,
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.error(`Enroll failed: ${msg}`, e?.stack ?? undefined);
      const dev = (process.env.NODE_ENV || "").toLowerCase() === "development";
      throw new InternalServerErrorException(dev ? `Enroll failed: ${msg}` : "Enroll failed");
    }
  }

  async validateAgentToken(rawToken: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM public.agents
       WHERE agent_token = $1
          OR token = $1
       LIMIT 1
      `,
      [rawToken]
    );
    return rows[0]?.id ?? null;
  }
}
