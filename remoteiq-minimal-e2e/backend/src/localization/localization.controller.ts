import { Body, Controller, Get, HttpCode, Post, UsePipes, ValidationPipe } from "@nestjs/common";
import { LocalizationService } from "./localization.service";
import { LocalizationDto, LocalizationRow } from "./localization.dto";
import { RequirePerm } from "../auth/require-perm.decorator";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/admin/localization")
export class LocalizationController {
    constructor(private readonly svc: LocalizationService) { }

    @Get()
    @RequirePerm("settings.read")
    async get(): Promise<LocalizationRow | { exists: false }> {
        const row = await this.svc.get();
        return row ?? { exists: false };
    }

    @Post("save")
    @HttpCode(204)
    @RequirePerm("settings.write")
    async save(@Body() body: LocalizationDto): Promise<void> {
        await this.svc.upsert(body);
    }
}
