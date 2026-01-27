import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

export class PatchesLatestQueryDto {
    @IsString()
    deviceId!: string;
}

export class PatchScanDto {
    @IsString()
    deviceId!: string;

    @IsOptional()
    @IsBoolean()
    includeOptional?: boolean;
}

export class PatchInstallDto {
    @IsString()
    deviceId!: string;

    @IsOptional()
    @IsBoolean()
    includeOptional?: boolean;

    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    ids!: string[];
}

export type PatchSeverity = "Critical" | "Important" | "Moderate" | "Low" | string | null;

export type PatchStatus = "Installed" | "Required" | "Pending";

export type PatchRow = {
    id: string;
    title: string;
    severity: PatchSeverity;
    requiresReboot: boolean;
    kbIds: string[];
    status: PatchStatus;
};
