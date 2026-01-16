// src/health/health.module.ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { EmailHealthController } from "./email.health.controller";
import { SmtpModule } from "../smtp/smtp.module";

@Module({
  imports: [SmtpModule],
  controllers: [HealthController, EmailHealthController],
})
export class HealthModule { }
