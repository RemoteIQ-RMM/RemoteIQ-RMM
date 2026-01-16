// backend/src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PgPoolService } from "../storage/pg-pool.service";

function newOpaqueToken(): string {
  return randomBytes(18).toString("base64url");
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type EnrollInput = {
  enrollmentSecret: string;
  deviceId: string;
  hostname: string;
  os: string;
  arch: string;
  version: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly pg: PgPoolService) { }

  /**
   * Enroll (or re-enroll) an agent.
   * - Validates the shared enrollment secret
   * - If deviceId exists, rotates token & updates metadata
   * - Otherwise creates a new agent
   * - Returns { agentId, agentToken }
   *
   * Tables/columns expected:
   *   agents(id uuid pk, device_id text unique, hostname text, os text, arch text,
   *          version text, token_hash text, created_at timestamptz, updated_at timestamptz)
   */
  async enrollAgent(input: EnrollInput) {
    const expected = process.env.ENROLLMENT_SECRET || "";
    if (!expected || input.enrollmentSecret !== expected) {
      throw new UnauthorizedException("Invalid enrollment secret");
    }

    try {
      const token = newOpaqueToken();
      const tokenHash = hashToken(token);

      // Look up existing agent by deviceId to avoid duplicates
      const existing = await this.pg.query<{ id: string }>(
        `SELECT id FROM agents WHERE device_id = $1 LIMIT 1`,
        [input.deviceId],
      );

      let agentId: string;

      if (existing.rows[0]) {
        const { rows } = await this.pg.query<{ id: string }>(
          `UPDATE agents
              SET hostname   = $2,
                  os         = $3,
                  arch       = $4,
                  version    = $5,
                  token_hash = $6,
                  updated_at = now()
            WHERE id = $1
          RETURNING id`,
          [
            existing.rows[0].id,
            input.hostname,
            input.os,
            input.arch,
            input.version,
            tokenHash,
          ],
        );
        agentId = rows[0].id;
        this.logger.log(`Re-enrolled agent ${agentId} (deviceId=${input.deviceId}).`);
      } else {
        const { rows } = await this.pg.query<{ id: string }>(
          `INSERT INTO agents (device_id, hostname, os, arch, version, token_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now(), now())
           RETURNING id`,
          [
            input.deviceId,
            input.hostname,
            input.os,
            input.arch,
            input.version,
            tokenHash,
          ],
        );
        agentId = rows[0].id;
        this.logger.log(`Enrolled new agent ${agentId} (deviceId=${input.deviceId}).`);
      }

      return { agentId, agentToken: token };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.error(`Enroll failed: ${msg}`, e?.stack ?? undefined);
      const dev = (process.env.NODE_ENV || "").toLowerCase() === "development";
      throw new InternalServerErrorException(dev ? `Enroll failed: ${msg}` : "Enroll failed");
    }
  }

  /**
   * Validate an agent’s bearer token (opaque string).
   * Returns the agentId on success, or null on failure.
   */
  async validateAgentToken(rawToken: string): Promise<string | null> {
    const tokenHash = hashToken(rawToken);
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id FROM agents WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    return rows[0]?.id ?? null;
  }
}
