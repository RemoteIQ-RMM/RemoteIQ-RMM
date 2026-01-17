import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class ListTicketsQuery {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  // Legacy alias
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn(["open", "in_progress", "resolved", "closed"])
  status?: "open" | "in_progress" | "resolved" | "closed";

  @IsOptional()
  @IsIn(["low", "medium", "high", "urgent"])
  priority?: "low" | "medium" | "high" | "urgent";

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 25;
}
