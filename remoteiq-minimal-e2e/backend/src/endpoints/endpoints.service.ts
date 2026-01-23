import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import * as crypto from "crypto";

export type CreateEndpointDto = {
  clientId: string;
  siteId: string;
  os: "windows" | "linux" | "macos";
  deviceId: string;
  alias: string;
  expiresMinutes: number;
};

export type CreateEndpointResponse = {
  deviceId: string;
  enrollmentSecret: string;
  expiresAt: string;
  clientId?: string;
  siteId?: string;
  os?: "windows" | "linux" | "macos";
  alias?: string;
};

@Injectable()
export class EndpointsService {
  constructor(private readonly pg: PgPoolService) {}

  async createEndpoint(dto: CreateEndpointDto): Promise<CreateEndpointResponse> {
    const clientId = String(dto.clientId ?? "").trim();
    const siteId = String(dto.siteId ?? "").trim();
    const deviceId = String(dto.deviceId ?? "").trim();
    const alias = String(dto.alias ?? "").trim();
    const os = dto.os;
    const expiresMinutes = Number(dto.expiresMinutes);

    if (!clientId) throw new BadRequestException("clientId is required");
    if (!siteId) throw new BadRequestException("siteId is required");
    if (!deviceId) throw new BadRequestException("deviceId is required");
    if (!alias) throw new BadRequestException("alias is required");
    if (!os) throw new BadRequestException("os is required");

    if (!Number.isFinite(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 24 * 60) {
      throw new BadRequestException("expiresMinutes must be between 1 and 1440");
    }

    // Ensure site belongs to client
    const siteCheck = await this.pg.query<{ ok: boolean }>(
      `
      SELECT TRUE AS ok
      FROM public.sites s
      WHERE s.id = $1::uuid
        AND s.client_id = $2::uuid
      LIMIT 1
      `,
      [siteId, clientId]
    );

    if (!siteCheck.rows[0]?.ok) {
      throw new NotFoundException("Site not found under that client");
    }

    // Ensure device row exists (deviceId is the canonical devices.id)
    // We store alias in the token table for now. If you later add a devices.alias column,
    // you can also upsert it here.
    await this.pg.query(
      `
      INSERT INTO public.devices (id, site_id, hostname, operating_system, status, last_seen_at)
      VALUES ($1::uuid, $2::uuid, $3::text, $4::text, 'offline', NULL)
      ON CONFLICT (id) DO UPDATE
        SET site_id = EXCLUDED.site_id,
            operating_system = EXCLUDED.operating_system
      `,
      [deviceId, siteId, alias, os]
    );

    const secret = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);

    const { rows } = await this.pg.query<{ secret: string; expires_at: string }>(
      `
      INSERT INTO public.device_enrollment_tokens
        (device_id, client_id, site_id, os, alias, secret, expires_at)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::timestamptz)
      RETURNING secret, expires_at
      `,
      [deviceId, clientId, siteId, os, alias, secret, expiresAt.toISOString()]
    );

    const r = rows[0];
    return {
      deviceId,
      enrollmentSecret: r.secret,
      expiresAt: new Date(r.expires_at).toISOString(),
      clientId,
      siteId,
      os,
      alias,
    };
  }
}
