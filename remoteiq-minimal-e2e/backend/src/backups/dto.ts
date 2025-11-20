// remoteiq-minimal-e2e/backend/src/backups/dto.ts
import {
    IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString,
    IsUUID, Min, Max, ValidateNested, IsObject, Matches, ValidateIf,
} from "class-validator";
import { Type, Transform } from "class-transformer";

export const SCHEDULES = ["hourly", "daily", "weekly", "cron"] as const;
export type ScheduleKind = typeof SCHEDULES[number];

export type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";
export type Destination =
    | { kind: "local"; path: string }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string }
    | { kind: "nextcloud"; connectionId: string; path: string }
    | { kind: "gdrive"; connectionId: string; subfolder?: string }
    | { kind: "remote"; connectionId: string; path: string }; // SFTP

export class NotificationsDto {
    @IsOptional() @IsBoolean() email?: boolean;
    @IsOptional() @IsBoolean() webhook?: boolean;
    @IsOptional() @IsBoolean() slack?: boolean;
}

/** Primary (legacy) destination DTOs */
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

/** Additional (fan-out) destination item */
export class FanoutDestinationDto {
    @IsIn(["local", "s3", "nextcloud", "gdrive", "remote"])
    kind!: Destination["kind"];

    // Convert "" -> undefined so optional validators don't fire on empty strings
    @Transform(({ value }) => (value === "" ? undefined : value))
    @IsOptional()
    @ValidateIf(o => o.kind !== "local" && o.connectionId !== undefined)
    @IsUUID()
    connectionId?: string;          // s3/nextcloud/gdrive/remote

    // Paths (only required by certain kinds; service layer also validates specifics)
    @IsOptional()
    @ValidateIf(o => o.kind === "local" || o.kind === "remote" || o.kind === "nextcloud")
    @IsString()
    path?: string;                  // local / remote / nextcloud

    // S3 options
    @IsOptional() @IsString()
    bucket?: string;
    @IsOptional() @IsString()
    prefix?: string;

    // GDrive option
    @IsOptional() @IsString()
    subfolder?: string;

    @IsOptional() @IsBoolean()
    isPrimary?: boolean;            // server normalizes; only one should be true

    @IsOptional() @IsInt() @Min(0) @Max(100000)
    priority?: number;              // ordering / tie-breaker
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
    destination!: Destination; // primary (kept for compatibility)

    /** NEW: extra fan-out destinations (in addition to primary) */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FanoutDestinationDto)
    extraDestinations?: FanoutDestinationDto[];

    /** Optional notification toggles */
    @IsOptional() @ValidateNested()
    @Type(() => NotificationsDto)
    notifications?: NotificationsDto;

    /** Optional runner hints; persisted into policy.options */
    @IsOptional() @IsInt() @Min(1) @Max(64)
    parallelism?: number;

    @IsOptional() @IsInt() @Min(1) @Max(64)
    minSuccess?: number;
}

export class HistoryQueryDto {
    @IsOptional() @IsString() cursor?: string;
    @IsOptional() @IsIn(["success", "failed", "running"]) status?: "success" | "failed" | "running";
    @IsOptional() @IsString() q?: string;
    @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
    @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class TestDestinationDto {
    @ValidateNested()
    @Type(() => Object)
    destination!: Destination;
}
