// remoteiq-minimal-e2e/backend/src/common/agent-token.util.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PgPoolService } from "../storage/pg-pool.service";

export type AgentAuthContext = {
  id: string; // uuid
  deviceId?: string; // uuid (string)
  token?: string; // raw agent token
};

export function getAgentFromRequest(req: any): AgentAuthContext {
  return (req as any).agent as AgentAuthContext;
}

type AgentRow = {
  id: string;
  device_id: string | null;
  agent_token: string | null;
};

@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly db: PgPoolService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers["authorization"];
    if (!authHeader || Array.isArray(authHeader)) {
      throw new UnauthorizedException("Missing Authorization header");
    }

    const match = /^Bearer\s+(.+)$/.exec(authHeader);
    if (!match) {
      throw new UnauthorizedException("Invalid Authorization header format");
    }

    const token = match[1];

    const { rows } = await this.db.query<AgentRow>(
      `SELECT id, device_id, agent_token
         FROM public.agents
        WHERE agent_token = $1
        LIMIT 1`,
      [token],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException("Invalid or unknown agent token");
    }

    (req as any).agent = {
      id: rows[0].id,
      deviceId: rows[0].device_id ?? undefined,
      token,
    } as AgentAuthContext;

    return true;
  }
}
