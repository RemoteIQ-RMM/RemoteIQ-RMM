import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class PatchScanDto {
    @IsUUID()
    deviceId!: string;

    @IsOptional()
    @IsBoolean()
    includeOptional?: boolean;
}
