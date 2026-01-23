// backend/src/provisioning/dto/create-enrollment-key.dto.ts
import { IsInt, IsOptional, IsString, Max, Min, Matches, MaxLength } from "class-validator";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CreateEnrollmentKeyDto {
    @IsString()
    @Matches(UUID_REGEX, { message: "clientId must be a UUID" })
    clientId!: string;

    @IsString()
    @Matches(UUID_REGEX, { message: "siteId must be a UUID" })
    siteId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(43200) // up to 30 days
    expiresMinutes?: number;
}

export type CreateEnrollmentKeyResult = {
    enrollmentKey: string; // raw token returned ONCE
    tokenId: string; // uuid
    expiresAt: string; // ISO
    clientId: string;
    siteId: string;
    name: string | null;
};
