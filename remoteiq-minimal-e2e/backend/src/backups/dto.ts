import {
    IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString,
    IsUUID, Min, Max, ValidateNested, IsObject, Matches
} from "class-validator";
import { Type } from "class-transformer";

export const SCHEDULES = ["hourly", "daily", "weekly", "cron"] as const;
export type ScheduleKind = typeof SCHEDULES[number];

export type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";
export type Destination =
    | { kind: "local"; path: string }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string }
    | { kind: "nextcloud"; connectionId: string; path: string }
    | { kind: "gdrive"; connectionId: string; subfolder?: string }
    | { kind: "remote"; connectionId: string; path: string };

export class NotificationsDto {
    @IsOptional() @IsBoolean() email?: boolean;
    @IsOptional() @IsBoolean() webhook?: boolean;
    @IsOptional() @IsBoolean() slack?: boolean;
}

export class LocalDestDto {
    @IsIn(["local"]) kind!: "local";
    @IsString() path!: string;
}

export class S3DestDto {
    @IsIn(["s3"]) kind!: "s3";
    @IsUUID() connectionId!: string;
    @IsOptional() @IsString() bucket?: string;
    @IsOptional() @IsString() prefix?: string;
}

export class NextcloudDestDto {
    @IsIn(["nextcloud"]) kind!: "nextcloud";
    @IsUUID() connectionId!: string;
    @IsString() path!: string;
}

export class GDriveDestDto {
    @IsIn(["gdrive"]) kind!: "gdrive";
    @IsUUID() connectionId!: string;
    @IsOptional() @IsString() subfolder?: string;
}

export class RemoteDestDto {
    @IsIn(["remote"]) kind!: "remote";
    @IsUUID() connectionId!: string;
    @IsString() path!: string;
}

export class DestinationDto {
    @IsIn(["local", "s3", "nextcloud", "gdrive", "remote"])
    kind!: Destination["kind"];
}

export class BackupConfigDto {
    @IsBoolean() enabled!: boolean;

    @IsArray() @IsString({ each: true })
    targets!: string[]; // UI-enforced values

    @IsIn(SCHEDULES as unknown as string[]) schedule!: ScheduleKind;

    @IsOptional()
    @Matches(/^(\S+\s+){4}\S+$/)
    cronExpr?: string;

    @IsInt() @Min(1) @Max(3650)
    retentionDays!: number;

    @IsBoolean() encrypt!: boolean;

    @IsObject()
    destination!: Destination;

    @IsOptional() @ValidateNested()
    @Type(() => NotificationsDto)
    notifications?: NotificationsDto;
}

export class HistoryQueryDto {
    @IsOptional() @IsString() cursor?: string;
    @IsOptional() @IsIn(["success", "failed", "running"]) status?: "success" | "failed" | "running";
    @IsOptional() @IsString() q?: string;
    @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
    @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class TestDestinationDto {
    @ValidateNested() @Type(() =>
        Object
    ) destination!: Destination;
}
