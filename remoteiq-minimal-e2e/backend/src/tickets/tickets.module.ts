import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";

import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { CannedResponsesService } from "./canned-responses.service";
import { AdminTicketingController } from "./admin-ticketing.controller";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [TicketsController, AdminTicketingController],
  providers: [TicketsService, CannedResponsesService],
  exports: [TicketsService, CannedResponsesService],
})
export class TicketsModule { }
