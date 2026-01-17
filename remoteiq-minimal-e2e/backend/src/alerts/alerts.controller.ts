import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
    IsArray,
    IsEnum,
    IsISO8601,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
} from "class-validator";
import { AlertsService, AlertState } from "./alerts.service";
import { RequirePerm } from "../auth/require-perm.decorator";

class ListAlertsQuery {
    @IsOptional() @IsArray() @IsEnum(AlertState, { each: true }) state?: AlertState[];
    @IsOptional() @IsArray() @IsString({ each: true }) severity?: ("WARN" | "CRIT")[];
    @IsOptional() @IsUUID() clientId?: string;
    @IsOptional() @IsUUID() siteId?: string;
    @IsOptional() @IsUUID() deviceId?: string;
    @IsOptional() @IsString() type?: string;
    @IsOptional() @IsString() q?: string;
    @IsOptional() @IsISO8601() from?: string;
    @IsOptional() @IsISO8601() to?: string;
    @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
    @IsOptional() @IsString() cursor?: string;
}

class ReasonDto {
    @IsOptional() @IsString() reason?: string;
}

class SilenceDto extends ReasonDto {
    @IsOptional() @IsISO8601() until?: string;
}

class BulkDto extends SilenceDto {
    @IsOptional() @IsArray() @IsUUID("4", { each: true }) ids?: string[];
    @IsOptional() filter?: Record<string, any>;
    @IsIn(["ack", "silence", "resolve"] as const) action!: "ack" | "silence" | "resolve";
}

@Controller("api/alerts")
export class AlertsController {
    constructor(private readonly alerts: AlertsService) { }

    @Get()
    @RequirePerm("alerts.read")
    async list(@Query() query: ListAlertsQuery) {
        return this.alerts.list(query);
    }

    @Get(":id/timeline")
    @RequirePerm("alerts.read")
    async timeline(@Param("id", new ParseUUIDPipe()) id: string) {
        return this.alerts.getTimeline(id);
    }

    @Post(":id/ack")
    @RequirePerm("alerts.manage")
    async ack(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: ReasonDto) {
        return this.alerts.ack(id, body?.reason);
    }

    @Post(":id/silence")
    @RequirePerm("alerts.manage")
    async silence(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: SilenceDto) {
        return this.alerts.silence(id, body?.reason, body?.until ?? null);
    }

    @Post(":id/unsilence")
    @RequirePerm("alerts.manage")
    async unsilence(@Param("id", new ParseUUIDPipe()) id: string) {
        return this.alerts.unsilence(id);
    }

    @Post(":id/resolve")
    @RequirePerm("alerts.manage")
    async resolve(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: ReasonDto) {
        return this.alerts.resolve(id, body?.reason);
    }

    @Post("bulk")
    @RequirePerm("alerts.manage")
    async bulk(@Body() body: BulkDto) {
        return this.alerts.bulk(body.action, body);
    }
}
