// backend/src/company/company.controller.ts
import { Body, Controller, Get, HttpCode, Post, UsePipes, ValidationPipe } from "@nestjs/common";
import { CompanyService } from "./company.service";
import { CompanyProfile, CompanyProfileDto } from "./company.dto";
import { RequirePerm } from "../auth/require-perm.decorator";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/admin/company") // keep paths used by the frontend
export class CompanyController {
    constructor(private readonly svc: CompanyService) { }

    @Get()
    @RequirePerm("settings.read")
    async get(): Promise<CompanyProfile | { exists: false }> {
        const row = await this.svc.get();
        return row ?? { exists: false };
    }

    @Post("save")
    @HttpCode(204)
    @RequirePerm("settings.write")
    async save(@Body() body: CompanyProfileDto): Promise<void> {
        await this.svc.upsert(body);
    }
}
