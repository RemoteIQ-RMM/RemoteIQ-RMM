import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
  NotFoundException,
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { ListTicketsQuery } from "./dto/list-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";
import { RequirePerm } from "../auth/require-perm.decorator";

import { FilesInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { CannedResponsesService } from "./canned-responses.service";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }))
@Controller("/api/tickets")
export class TicketsController {
  constructor(
    private readonly svc: TicketsService,
    private readonly canned: CannedResponsesService
  ) { }

  @Get()
  @RequirePerm("tickets.read")
  async list(@Query() q: ListTicketsQuery, @Req() req: any) {
    const result = await this.svc.list(q, req);
    return result.items;
  }

  // ✅ fixed: use CannedResponsesService (not TicketsService)
  @Get("canned-responses")
  @RequirePerm("tickets.read")
  async cannedResponses(@Req() req: any) {
    return await this.canned.listForTicketUse(req); // returns [{id,title,body}]
  }

  // Optional: definitions (preset + custom keys)
  @Get("canned-variables")
  @RequirePerm("tickets.read")
  async cannedVariables(@Req() req: any) {
    return await this.canned.listVariableDefinitionsForTicketUse(req); // returns [{key,label,description,source}]
  }

  // Optional: values for a specific ticket
  @Get(":id/canned-variables")
  @RequirePerm("tickets.read")
  async cannedVariableValues(@Param("id") id: string, @Req() req: any) {
    return await this.canned.listVariableValuesForTicket(id, req); // returns [{key,value}]
  }

  // ✅ Used by the UI to insert rendered canned text
  @Post(":id/canned-render")
  @RequirePerm("tickets.read")
  async renderCanned(
    @Param("id") id: string,
    @Body() body: { template?: string },
    @Req() req: any
  ) {
    const template = String(body?.template ?? "");
    const rendered = await this.canned.renderForTicket(id, template, req);
    return { rendered };
  }

  @Get(":id/activity")
  @RequirePerm("tickets.read")
  async activity(@Param("id") id: string, @Req() req: any) {
    return this.svc.getActivity(id, req);
  }

  @Get(":id/history")
  @RequirePerm("tickets.read")
  async history(@Param("id") id: string, @Req() req: any) {
    return this.svc.getHistory(id, req);
  }

  @Get(":id/linked")
  @RequirePerm("tickets.read")
  async linked(@Param("id") id: string, @Req() req: any) {
    return this.svc.getLinked(id, req);
  }

  @Post(":id/linked")
  @RequirePerm("tickets.write")
  async linkTicket(@Param("id") id: string, @Body() body: { linkedId?: string }, @Req() req: any) {
    const linkedId = String(body?.linkedId ?? "").trim();
    if (!linkedId) throw new BadRequestException("linkedId is required (UUID or ticket number)");
    return this.svc.addLink(id, linkedId, req);
  }

  @Post(":id/attachments")
  @RequirePerm("tickets.write")
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = path.join(process.cwd(), "public", "uploads", "tickets");
          try {
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
          } catch (e) {
            cb(e as any, dir);
          }
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname || "").slice(0, 12);
          const safeExt = /^[a-z0-9.]+$/i.test(ext) ? ext : "";
          cb(null, `${randomUUID()}${safeExt}`);
        },
      }),
      limits: {
        files: 10,
        fileSize: 25 * 1024 * 1024,
      },
    })
  )
  async uploadAttachments(@Param("id") _id: string, @UploadedFiles() files: Express.Multer.File[]) {
    const arr = Array.isArray(files) ? files : [];
    return arr.map((f) => ({
      id: randomUUID(),
      name: f.originalname,
      url: `/static/uploads/tickets/${f.filename}`,
    }));
  }

  @Post(":id/reply")
  @RequirePerm("tickets.write")
  async reply(
    @Param("id") id: string,
    @Body()
    body: {
      body?: string;
      timeWorkedSeconds?: number;
      attachments?: any[];
      notifyCustomer?: boolean;
      submitAs?: "reply" | "reply_and_close" | "reply_and_resolve";
    },
    @Req() req: any
  ) {
    const submitAs = body?.submitAs;
    if (submitAs === "reply_and_close") {
      await this.svc.update(id, { status: "closed" } as any, req);
    } else if (submitAs === "reply_and_resolve") {
      await this.svc.update(id, { status: "resolved" } as any, req);
    }

    await this.svc.addMessageOrNote(id, req, "message", {
      body: body?.body,
      attachments: body?.attachments,
      notifyCustomer: body?.notifyCustomer,
    });

    return { ok: true };
  }

  @Post(":id/note")
  @RequirePerm("tickets.write")
  async note(
    @Param("id") id: string,
    @Body()
    body: {
      body?: string;
      timeWorkedSeconds?: number;
      attachments?: any[];
      notifyCustomer?: boolean;
      submitAs?: string;
    },
    @Req() req: any
  ) {
    await this.svc.addMessageOrNote(id, req, "note", {
      body: body?.body,
      attachments: body?.attachments,
      notifyCustomer: false,
    });
    return { ok: true };
  }

  @Get(":id")
  @RequirePerm("tickets.read")
  async getOne(@Param("id") id: string, @Req() req: any) {
    const item = await this.svc.getOne(id, req);
    if (!item) throw new NotFoundException("Ticket not found");
    return item;
  }

  @Post()
  @RequirePerm("tickets.write")
  async create(@Body() dto: CreateTicketDto, @Req() req: any) {
    const id = await this.svc.create(dto, req);
    return { id };
  }

  @Patch(":id")
  @RequirePerm("tickets.write")
  async update(@Param("id") id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    const ok = await this.svc.update(id, dto, req);
    if (!ok) throw new NotFoundException("Ticket not found");
    return { ok: true };
  }
}
