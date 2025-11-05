import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateTicketDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsString()
  @MaxLength(300)
  title!: string;

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
