import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  NotFoundException,
} from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { ListTicketsQuery } from "./dto/list-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";
import { AuthCookieGuard } from "../auth/auth-cookie.guard";

@UseGuards(AuthCookieGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }))
@Controller("/api/tickets")
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  /** List tickets. By default returns all tickets across customers. Provide ?customerId= to scope. */
  @Get()
  async list(@Query() q: ListTicketsQuery) {
    return this.svc.list(q);
  }

  /** Get one ticket by id */
  @Get(":id")
  async getOne(@Param("id") id: string) {
    const item = await this.svc.getOne(id);
    if (!item) throw new NotFoundException("Ticket not found");
    return item;
  }

  /** Create ticket */
  @Post()
  async create(@Body() dto: CreateTicketDto) {
    const id = await this.svc.create(dto);
    return { id };
  }

  /** Update ticket (partial) */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateTicketDto) {
    const ok = await this.svc.update(id, dto);
    if (!ok) throw new NotFoundException("Ticket not found");
    return { ok: true };
  }
}
