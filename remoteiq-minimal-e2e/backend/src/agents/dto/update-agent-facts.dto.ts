// backend/src/agents/dto/update-agent-facts.dto.ts
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateAgentFactsDto {
    @IsOptional()
    @IsIn(["windows", "linux", "macos"])
    os?: "windows" | "linux" | "macos";

    @IsOptional()
    @IsIn(["x64", "arm64", "x86"])
    arch?: "x64" | "arm64" | "x86";

    @IsOptional()
    @IsString()
    @MaxLength(100)
    hostname?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    version?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    primaryIp?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    user?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    loggedInUser?: string;

    // ✅ allow agent to send a device summary blob
    @IsOptional()
    @IsObject()
    facts?: Record<string, any>;
}
