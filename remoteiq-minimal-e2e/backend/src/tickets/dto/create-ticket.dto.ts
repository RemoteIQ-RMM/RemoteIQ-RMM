import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateTicketDto {
  // Preferred
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  // Legacy alias (maps to organizationId)
  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Preferred field name for UI
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  // Legacy alias (maps to subject)
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
  @IsUUID()
  requesterContactId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
