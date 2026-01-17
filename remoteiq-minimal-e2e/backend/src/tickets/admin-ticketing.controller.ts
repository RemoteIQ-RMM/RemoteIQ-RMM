import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { RequirePerm } from "../auth/require-perm.decorator";
import { CannedResponsesService } from "./canned-responses.service";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }))
@Controller("/api/admin/ticketing")
export class AdminTicketingController {
    constructor(private readonly canned: CannedResponsesService) { }

    @Get("canned-responses")
    @RequirePerm("tickets.canned.read")
    async list(@Req() req: any) {
        return { items: await this.canned.adminList(req) };
    }

    @Post("canned-responses")
    @RequirePerm("tickets.canned.write")
    async create(
        @Req() req: any,
        @Body() body: { title: string; body: string; isActive?: boolean }
    ) {
        return await this.canned.adminCreate(req, body);
    }

    @Patch("canned-responses/:id")
    @RequirePerm("tickets.canned.write")
    async update(
        @Req() req: any,
        @Param("id") id: string,
        @Body() body: { title?: string; body?: string; isActive?: boolean }
    ) {
        return await this.canned.adminUpdate(req, id, body);
    }

    @Delete("canned-responses/:id")
    @RequirePerm("tickets.canned.write")
    async remove(@Req() req: any, @Param("id") id: string) {
        return await this.canned.adminDelete(req, id);
    }
}
