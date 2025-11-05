import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UpdateTicketDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(["open", "in_progress", "resolved", "closed"])
  status?: "open" | "in_progress" | "resolved" | "closed";

  @IsOptional()
  @IsIn(["low", "medium", "high", "urgent"])
  priority?: "low" | "medium" | "high" | "urgent";

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsEmail()
  requesterEmail?: string;
}
