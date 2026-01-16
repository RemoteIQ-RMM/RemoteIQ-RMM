// backend/src/main.ts
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";
import { WsAdapter } from "@nestjs/platform-ws";
import { ValidationPipe, INestApplication } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

// 👇 add this import to serve static files
import { NestExpressApplication } from "@nestjs/platform-express";

// Pg + interceptor
import { PgPoolService } from "./storage/pg-pool.service";
import { SessionHeartbeatInterceptor } from "./auth/session-heartbeat.interceptor";

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
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Keep legacy /docs and ALSO support /api/docs (what you tested)
    SwaggerModule.setup("/docs", app, document);
    SwaggerModule.setup("/api/docs", app, document);

    console.log("Swagger docs mounted at /docs and /api/docs");
    console.log("Swagger JSON available at /docs-json and /api/docs-json");
  } catch {
    console.log("Swagger not installed. Skip docs (pnpm add -D @nestjs/swagger swagger-ui-express)");
  }
}

function configureCors(app: INestApplication) {
  const isProd = process.env.NODE_ENV === "production";

  const listFromFrontends =
    (process.env.FRONTEND_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const listFromAllowed = (process.env.ALLOWED_ORIGIN || "")
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

  // 👇 tell Nest this is an Express app so we can useStaticAssets
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 👇 serve /static/* from ./public/*
  app.useStaticAssets(path.join(process.cwd(), "public"), {
    prefix: "/static/",
  });

  app.use(cookieParser());
  configureCors(app);

  // ✅ TS-only fix for Nest websocket adapter interface mismatch
  app.useWebSocketAdapter(new WsAdapter(app) as any);

  const isProd = process.env.NODE_ENV === "production";

  // ✅ Key change:
  // - In prod: forbid unknown fields (security)
  // - In dev: strip unknown fields instead of throwing 400 (unblocks UI during iteration)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: isProd,
      transform: true,
      forbidUnknownValues: true,
    })
  );

  app.enableShutdownHooks();

  app.getHttpAdapter().getInstance().get("/healthz", (_req: any, res: any) => res.send("OK"));

  await maybeSetupSwagger(app);

  // ✅ Register SessionHeartbeatInterceptor only if PgPoolService is resolvable
  try {
    const pg = app.get(PgPoolService, { strict: false });
    if (pg) {
      app.useGlobalInterceptors(new SessionHeartbeatInterceptor(pg));
      console.log("SessionHeartbeatInterceptor enabled.");
    } else {
      console.warn(
        "PgPoolService not found in AppModule context; SessionHeartbeatInterceptor NOT enabled."
      );
    }
  } catch (err) {
    console.warn(
      "Could not enable SessionHeartbeatInterceptor (continuing without it):",
      (err as Error)?.message || err
    );
  }

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  console.log(`API up on http://localhost:${port}`);
}
bootstrap();
