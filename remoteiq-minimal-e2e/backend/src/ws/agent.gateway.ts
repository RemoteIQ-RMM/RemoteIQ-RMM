// backend/src/ws/agent.gateway.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server as WsServer, WebSocket, RawData } from "ws";

import { SocketRegistry, type AgentSocket } from "../common/socket-registry.service";
import { DispatcherService } from "../jobs/dispatcher.service";
import { JobsService } from "../jobs/jobs.service";

type JobResultMsg = {
  t: "job_result";
  jobId: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  status?: string; // agent may send custom text, we will map to our enum
};

type AgentHelloMsg = {
  t: "agent_hello";
  agentId?: string;
  deviceId?: string;
  hostname?: string;
  os?: string;
  arch?: string;
  version?: string;
};

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return "";
}

/**
 * Agent WebSocket endpoint.
 * NOTE: Must NOT share the same `path` as DashboardGateway, otherwise one of them will never receive connections.
 */
@WebSocketGateway({ path: "/ws/agent" })
@Injectable()
export class AgentGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("AgentGateway");

  @WebSocketServer()
  private ws!: WsServer;

  constructor(
    private readonly sockets: SocketRegistry,
    @Inject(forwardRef(() => DispatcherService))
    private readonly dispatcher: DispatcherService,
    @Inject(forwardRef(() => JobsService))
    private readonly jobs: JobsService,
  ) { }

  onModuleInit() {
    if (!this.ws) {
      this.log.warn("WS server not initialized by adapter; ensure a WS adapter is configured.");
      return;
    }

    this.ws.on("connection", (socket: WebSocket & Partial<AgentSocket>) => {
      this.log.debug("Agent WS connected (awaiting hello)");

      socket.on("message", async (data: RawData) => {
        const text = rawToString(data);
        if (!text) return;

        let msg: any;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        const t = msg?.t as string | undefined;
        if (!t) return;

        if (t === "agent_hello") {
          const hello = msg as AgentHelloMsg;
          const agentId = String(hello.agentId ?? "").trim();
          const deviceId = String(hello.deviceId ?? "").trim();
          const hostname = String(hello.hostname ?? "").trim();

          if (!agentId) {
            this.log.warn("agent_hello missing agentId; closing socket.");
            socket.close(1008, "agentId required");
            return;
          }

          // Persist identifiers on the socket so cleanup works
          (socket as AgentSocket).agentId = agentId;
          (socket as AgentSocket).deviceId = deviceId || undefined;
          // AgentSocket doesn't declare hostname; store it loosely for logs/debug
          (socket as any).hostname = hostname || undefined;

          // Register into the registry
          this.sockets.set(agentId, deviceId || undefined, socket as AgentSocket);

          this.log.log(
            `Registered agent socket: agentId=${agentId}` +
            (deviceId ? ` deviceId=${deviceId}` : "") +
            (hostname ? ` host=${hostname}` : ""),
          );

          try {
            await this.dispatcher.dispatchQueuedForAgent(agentId);
          } catch (e: any) {
            this.log.warn(`dispatchQueuedForAgent failed: ${e?.message ?? e}`);
          }
          return;
        }

        if (t === "job_result") {
          const jr = msg as JobResultMsg;
          if (!jr.jobId) {
            this.log.warn("job_result missing jobId; ignoring");
            return;
          }

          const exitCode = Number.isFinite(jr.exitCode) ? Number(jr.exitCode) : -1;
          const stdout = typeof jr.stdout === "string" ? jr.stdout : "";
          const stderr = typeof jr.stderr === "string" ? jr.stderr : "";
          const durationMs = Number.isFinite(jr.durationMs) ? Number(jr.durationMs) : 0;

          // Map to our JobsService status enum: "succeeded" | "failed" | "timeout"
          let status: "succeeded" | "failed" | "timeout";
          const s = (jr.status ?? "").toLowerCase();
          if (s === "timeout") status = "timeout";
          else if (s === "succeeded" || (s === "finished" && exitCode === 0) || exitCode === 0) status = "succeeded";
          else status = "failed";

          try {
            await this.jobs.finishJob(
              jr.jobId,
              { exitCode, stdout, stderr, durationMs },
              status,
            );
          } catch (e: any) {
            this.log.warn(`finishJob failed for ${jr.jobId}: ${e?.message ?? e}`);
          }
          return;
        }
      });

      socket.on("close", () => {
        const s = socket as AgentSocket;
        if (s.agentId) this.sockets.deleteByAgent(s.agentId);
        if (s.deviceId) this.sockets.deleteByDevice(s.deviceId);
      });

      socket.on("error", () => {
        // close handler will clean up
      });
    });
  }

  onModuleDestroy() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  /**
   * Broadcast a JSON message to all connected agent sockets.
   * automation.controller.ts expects this to exist.
   */
  public broadcast(payload: unknown, filter?: (s: AgentSocket) => boolean): number {
    if (!this.ws?.clients) return 0;
    let sent = 0;
    for (const client of this.ws.clients) {
      const sock = client as AgentSocket;
      // 'OPEN' is a numeric const on ws WebSocket instances
      if ((client as any).readyState !== (client as any).OPEN) continue;
      if (filter && !filter(sock)) continue;
      try {
        client.send(JSON.stringify(payload));
        sent++;
      } catch {
        // ignore per-socket send errors
      }
    }
    return sent;
  }
}
