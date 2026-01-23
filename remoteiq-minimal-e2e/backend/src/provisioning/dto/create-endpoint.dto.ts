import { IsIn, IsInt, IsOptional, IsString, Max, Min, Matches } from "class-validator";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CreateEndpointDto {
    @IsString()
    @Matches(UUID_REGEX, { message: "clientId must be a UUID" })
    clientId!: string;

    @IsString()
    @Matches(UUID_REGEX, { message: "siteId must be a UUID" })
    siteId!: string;

    @IsString()
    @Matches(UUID_REGEX, { message: "deviceId must be a UUID" })
    deviceId!: string;

    @IsString()
    @IsIn(["windows", "linux", "macos"])
    os!: "windows" | "linux" | "macos";

    @IsString()
    alias!: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1440)
    expiresMinutes?: number;
}

export type CreateEndpointResult = {
    deviceId: string;
    enrollmentSecret: string; // one-time token to pass as enrollmentSecret
    expiresAt: string; // ISO
    clientId: string;
    siteId: string;
    os: "windows" | "linux" | "macos";
    alias: string;
};
