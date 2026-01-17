import { Body, Controller, Get, HttpCode, Post, UsePipes, ValidationPipe } from "@nestjs/common";
import { SupportLegalService } from "./support-legal.service";
import { SupportLegal, SupportLegalDto } from "./support-legal.dto";
import { RequirePerm } from "../auth/require-perm.decorator";

@Controller("/api/admin/support-legal")
export class SupportLegalController {
    constructor(private readonly svc: SupportLegalService) { }

    @Get()
    @RequirePerm("settings.read")
    async get(): Promise<SupportLegal | { exists: false }> {
        const row = await this.svc.get();
        return row ?? { exists: false };
    }

    @Post("save")
    @HttpCode(204)
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    @RequirePerm("settings.write")
    async save(@Body() body: SupportLegalDto): Promise<void> {
        await this.svc.upsert(body);
    }
}
