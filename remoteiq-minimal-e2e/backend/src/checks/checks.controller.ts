//remoteiq-minimal-e2e\backend\src\checks\checks.controller.ts

import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Put,
    Query,
} from "@nestjs/common";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from "class-validator";
import { ChecksService, CheckScope, CheckType } from "./checks.service";
import { RequirePerm } from "../auth/require-perm.decorator";

/* ========================= DTOs for /api/checks ========================== */

class ListChecksQuery {
    @IsOptional() @IsEnum(CheckScope) scope?: CheckScope;
    @IsOptional() @IsEnum(CheckType) type?: CheckType;
    @IsOptional() @IsBoolean() enabled?: boolean;
    @IsOptional() @IsUUID() clientId?: string;
    @IsOptional() @IsUUID() siteId?: string;
    @IsOptional() @IsUUID() deviceId?: string;
    @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
    @IsOptional() @IsString() cursor?: string;
}

class CreateCheckDto {
    @IsEnum(CheckScope) scope!: CheckScope;
    @ValidateIf((o) => o.scope !== CheckScope.GLOBAL) @IsUUID() @IsOptional() scopeId?: string;

    @IsEnum(CheckType) type!: CheckType;

    @IsString() name!: string;
    @IsString() @IsOptional() description?: string;

    @IsOptional() config?: unknown;
    @IsOptional() threshold?: unknown;

    @IsString() severityDefault!: "WARN" | "CRIT";

    @IsInt() @Min(15) @Max(86400) intervalSec!: number;
    @IsInt() @Min(1) @Max(600) timeoutSec!: number;

    @IsBoolean() enabled!: boolean;
}

class UpdateCheckDto {
    @IsOptional() @IsEnum(CheckScope) scope?: CheckScope;
    @ValidateIf((o) => o.scope && o.scope !== CheckScope.GLOBAL) @IsUUID() @IsOptional() scopeId?: string;

    @IsOptional() @IsEnum(CheckType) type?: CheckType;
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsString() description?: string;
    @IsOptional() config?: unknown;
    @IsOptional() threshold?: unknown;
    @IsOptional() @IsString() severityDefault?: "WARN" | "CRIT";
    @IsOptional() @IsInt() @Min(15) @Max(86400) intervalSec?: number;
    @IsOptional() @IsInt() @Min(1) @Max(600) timeoutSec?: number;
    @IsOptional() @IsBoolean() enabled?: boolean;
}

class RunOnDemandDto {
    @IsOptional() deviceIds?: string[] | null;
}

/* ===================== /api/checks controller ==================== */

@Controller("api/checks")
export class ChecksController {
    constructor(private readonly checks: ChecksService) { }

    @Get()
    @RequirePerm("checks.read")
    async list(@Query() query: ListChecksQuery) {
        return this.checks.list(query);
    }

    @Post()
    @RequirePerm("checks.write")
    async create(@Body() dto: CreateCheckDto) {
        return this.checks.create({
            ...dto,
            createdBy: "system",
            updatedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            id: "00000000-0000-0000-0000-000000000000",
        } as any);
    }

    @Put(":id")
    @RequirePerm("checks.write")
    async update(@Param("id") id: string, @Body() dto: UpdateCheckDto) {
        return this.checks.update(id, dto as any);
    }

    @Delete(":id")
    @RequirePerm("checks.delete")
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param("id") id: string) {
        await this.checks.remove(id);
        return;
    }

    @Post(":id/assignments/rebuild")
    @RequirePerm("checks.write")
    async rebuild(@Param("id") id: string) {
        return this.checks.rebuildAssignments(id);
    }

    @Post(":id/run")
    @RequirePerm("checks.run")
    async runOnDemand(@Param("id") id: string, @Body() dto: RunOnDemandDto) {
        return this.checks.runOnDemand(id, dto);
    }
}
