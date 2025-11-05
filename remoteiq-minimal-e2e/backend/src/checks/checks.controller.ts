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
} from '@nestjs/common';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { ChecksService, CheckScope, CheckType } from './checks.service';

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

    @IsString() severityDefault!: 'WARN' | 'CRIT';

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
    @IsOptional() @IsString() severityDefault?: 'WARN' | 'CRIT';
    @IsOptional() @IsInt() @Min(15) @Max(86400) intervalSec?: number;
    @IsOptional() @IsInt() @Min(1) @Max(600) timeoutSec?: number;
    @IsOptional() @IsBoolean() enabled?: boolean;
}

class RunOnDemandDto {
    @IsOptional() deviceIds?: string[] | null;
}

/* ===================== Existing /api/checks controller ==================== */

@Controller('api/checks')
export class ChecksController {
    constructor(private readonly checks: ChecksService) { }

    @Get()
    async list(@Query() query: ListChecksQuery) {
        return this.checks.list(query);
    }

    @Post()
    async create(@Body() dto: CreateCheckDto) {
        return this.checks.create({
            ...dto,
            createdBy: 'system',
            updatedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            id: '00000000-0000-0000-0000-000000000000',
        } as any);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateCheckDto) {
        return this.checks.update(id, dto as any);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('id') id: string) {
        await this.checks.remove(id);
        return;
    }

    @Post(':id/assignments/rebuild')
    async rebuild(@Param('id') id: string) {
        return this.checks.rebuildAssignments(id);
    }

    @Post(':id/run')
    async runOnDemand(@Param('id') id: string, @Body() dto: RunOnDemandDto) {
        return this.checks.runOnDemand(id, dto);
    }
}

/* ========= New device-scoped /api/devices/:deviceId/checks route =========== */

function clamp(n: any, min: number, max: number, def: number): number {
    const x = Number(n);
    if (!Number.isFinite(x)) return def;
    return Math.max(min, Math.min(max, Math.trunc(x)));
}

@Controller('api/devices')
export class DeviceChecksController {
    constructor(private readonly checks: ChecksService) { }

    /**
     * Device-scoped checks for the UI:
     * GET /api/devices/:deviceId/checks?limit=100
     *
     * deviceId is TEXT in DB; do NOT force UUID here.
     */
    @Get(':deviceId/checks')
    async deviceChecks(
        @Param('deviceId') deviceId: string,
        @Query('limit') limit?: string,
    ) {
        const lim = clamp(limit, 1, 200, 100);
        return this.checks.listByDevice(deviceId, lim);
    }
}
