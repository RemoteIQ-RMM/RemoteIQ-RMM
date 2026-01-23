// remoteiq-minimal-e2e/backend/src/main.ts

import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";
import { WsAdapter } from "@nestjs/platform-ws";
import { ValidationPipe, INestApplication } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";

import { NestExpressApplication } from "@nestjs/platform-express";

// Pg + interceptor
import { PgPoolService } from "./storage/pg-pool.service";
import { SessionHeartbeatInterceptor } from "./auth/session-heartbeat.interceptor";

// ✅ Global guards (deny-by-default)
import { AuthCookieGuard } from "./auth/auth-cookie.guard";
import { PermissionsGuard } from "./auth/permissions.guard";

/** Mount /docs only when allowed (and if @nestjs/swagger is present). */
async function maybeSetupSwagger(app: INestApplication) {
  const enableSwagger =
    (process.env.SWAGGER ?? "").toLowerCase() === "true" ||
    process.env.NODE_ENV !== "production";

  if (!enableSwagger) {
    console.log("Swagger disabled (set SWAGGER=true to enable).");
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");

    const config = new DocumentBuilder()
      .setTitle("RemoteIQ API")
      .setDescription("OpenAPI for RemoteIQ RMM")
      .setVersion("v1")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        "bearer"
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Keep legacy /docs and ALSO support /api/docs
    SwaggerModule.setup("/docs", app, document);
    SwaggerModule.setup("/api/docs", app, document);

    console.log("Swagger docs mounted at /docs and /api/docs");
    console.log("Swagger JSON available at /docs-json and /api/docs-json");
  } catch {
    console.log(
      "Swagger not installed. Skip docs (pnpm add -D @nestjs/swagger swagger-ui-express)"
    );
  }
}

function configureCors(app: INestApplication) {
  const isProd = process.env.NODE_ENV === "production";

  const listFromFrontends =
    (process.env.FRONTEND_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const listFromAllowed =
    (process.env.ALLOWED_ORIGIN || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const origins = listFromFrontends.length ? listFromFrontends : listFromAllowed;

  if (isProd && origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-api-key"],
      exposedHeaders: ["Content-Length"],
    });
    console.log("CORS restricted to:", origins);
  } else {
    app.enableCors({
      origin: (_origin, cb) => cb(null, true),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-api-key"],
      exposedHeaders: ["Content-Length"],
    });
    console.log("CORS open (dev). Set FRONTEND_ORIGINS or ALLOWED_ORIGIN for prod.");
  }
}

async function bootstrap() {
  // Ensure uploads directory exists (multer doesn't create it)
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Express app for cookie + ws adapter
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Note: ServeStaticModule already mounts /static -> ./public in AppModule.
  // So we do NOT call app.useStaticAssets() again here.

  app.use(cookieParser());
  configureCors(app);

  // ✅ TS-only fix for Nest websocket adapter interface mismatch
  app.useWebSocketAdapter(new WsAdapter(app) as any);

  const isProd = process.env.NODE_ENV === "production";

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: isProd,
      transform: true,
      forbidUnknownValues: true,
    })
  );

  app.enableShutdownHooks();

  await maybeSetupSwagger(app);

  // ✅ Deny-by-default security: enforce auth globally via DI instances
  // (This avoids APP_GUARD export/type issues and avoids "manual new()" problems.)
  const authGuard = app.get(AuthCookieGuard, { strict: false });
  const permGuard = app.get(PermissionsGuard, { strict: false });

  if (!authGuard || !permGuard) {
    if (isProd) {
      throw new Error("Global guards not found in DI; refusing to start in production.");
    }
    console.warn("Global guards not found in DI; NOT enabling AuthCookieGuard/PermissionsGuard.");
  } else {
    app.useGlobalGuards(authGuard, permGuard);
    console.log("Global guards enabled via DI: AuthCookieGuard + PermissionsGuard");
  }

  // ✅ SessionHeartbeatInterceptor only if PgPoolService is resolvable
  const pg = app.get(PgPoolService, { strict: false });
  if (!pg) {
    if (isProd) {
      throw new Error("PgPoolService not found; refusing to start in production.");
    }
    console.warn("PgPoolService not found; SessionHeartbeatInterceptor NOT enabled.");
  } else {
    app.useGlobalInterceptors(new SessionHeartbeatInterceptor(pg));
    console.log("SessionHeartbeatInterceptor enabled.");
  }

  const port = Number(process.env.PORT || 3001);
  // await app.listen(port);
  const server = await app.listen(port);

  const httpServer: any = app.getHttpAdapter().getInstance();
  const router = httpServer?._router;

  if (router?.stack) {
    const routes = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => {
        const path = l.route.path;
        const methods = Object.keys(l.route.methods)
          .filter((m) => l.route.methods[m])
          .map((m) => m.toUpperCase())
          .join(",");
        return `${methods.padEnd(10)} ${path}`;
      })
      .sort();
    Logger.log(`\nROUTES:\n${routes.join("\n")}\n`);
  }
  console.log(`API up on http://localhost:${port}`);
}

bootstrap();
