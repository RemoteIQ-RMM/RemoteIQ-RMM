import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class AgentTaskCompleteDto {
    @IsIn(["succeeded", "failed", "cancelled"])
    status!: "succeeded" | "failed" | "cancelled";

    @IsOptional()
    @IsString()
    @MaxLength(200000)
    stdout?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200000)
    stderr?: string;

    @IsOptional()
    @IsObject()
    output?: Record<string, any>;

    @IsOptional()
    @IsObject()
    artifacts?: Record<string, any>;
}
