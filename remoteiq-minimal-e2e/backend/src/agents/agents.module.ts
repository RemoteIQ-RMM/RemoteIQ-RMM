// backend/src/agents/agents.module.ts
import { Module } from "@nestjs/common";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { AgentsTasksService } from "./agents.tasks.service";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module"; // provides PgPoolService
import { CommonModule } from "../common/common.module"; // provides AgentTokenGuard utilities
import { ChecksModule } from "../checks/checks.module"; // provides ChecksService to controller

@Module({
  imports: [AuthModule, StorageModule, CommonModule, ChecksModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentsTasksService],
  exports: [AgentsService, AgentsTasksService],
})
export class AgentsModule { }
