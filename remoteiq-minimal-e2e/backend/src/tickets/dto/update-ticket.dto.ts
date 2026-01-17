import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UpdateTicketDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  // Legacy alias
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  // Legacy alias
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

  // ISO string or null to clear
  @IsOptional()
  @IsString()
  dueAt?: string | null;

  // ISO string or null to clear
  @IsOptional()
  @IsString()
  closedAt?: string | null;
}
