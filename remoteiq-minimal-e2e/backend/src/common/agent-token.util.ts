// remoteiq-minimal-e2e/backend/src/common/agent-token.util.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PgPoolService } from '../storage/pg-pool.service';

/** ───────────────────────────
 *  Crypto helpers
 *  ─────────────────────────── */
const algo = 'sha256';

export function hashToken(token: string): string {
  return crypto.createHash(algo).update(token).digest('hex');
}

export function newOpaqueToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function signAgentJwt(agentId: string): string {
  const secret = process.env.JWT_SECRET || 'dev';
  return jwt.sign({ sub: agentId, typ: 'agent' }, secret, { algorithm: 'HS256' });
}

export function verifyAgentJwt(token: string): string | null {
  try {
    const secret = process.env.JWT_SECRET || 'dev';
    const payload = jwt.verify(token, secret) as any;
    return payload?.sub as string;
  } catch {
    return null;
  }
}

/** ───────────────────────────
 *  Request augmentation helper
 *  ─────────────────────────── */
export type AgentAuthContext = {
  id: number;
  token?: string;
};

export function getAgentFromRequest(req: any): AgentAuthContext {
  return (req as any).agent as AgentAuthContext;
}

/** ───────────────────────────
 *  DB row shape(s)
 *  ─────────────────────────── */
type AgentRow = {
  id: number;
  token_hash: string | null;
};

/** ───────────────────────────
 *  Bearer token guard for agents
 *  ─────────────────────────── */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly db: PgPoolService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'];
    if (!authHeader || Array.isArray(authHeader)) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const match = /^Bearer\s+(.+)$/.exec(authHeader);
    if (!match) {
      throw new UnauthorizedException('Invalid Authorization header format');
    }

    const token = match[1];
    const tokenHash = hashToken(token);

    // Use the typed query helper (no private pool access)
    const { rows } = await this.db.query<AgentRow>(
      `SELECT id, token_hash
         FROM public.agents
        WHERE token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid or unknown agent token');
    }

    // Stash minimal agent context on the request
    (req as any).agent = { id: rows[0].id, token } as AgentAuthContext;

    return true;
  }
}
