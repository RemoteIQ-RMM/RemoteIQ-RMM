import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

export class PatchInstallDto {
    @IsUUID()
    deviceId!: string;

    @IsOptional()
    @IsBoolean()
    includeOptional?: boolean;

    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    ids!: string[];
}
