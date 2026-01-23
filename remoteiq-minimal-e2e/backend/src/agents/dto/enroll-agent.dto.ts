import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, Matches, ValidateIf } from "class-validator";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EnrollAgentDto {
    // One-time device-scoped secret
    @ValidateIf((o) => !o.enrollmentKey)
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    enrollmentSecret?: string;

    // Reusable site-scoped key
    @ValidateIf((o) => !o.enrollmentSecret)
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    enrollmentKey?: string;

    @IsString()
    @IsNotEmpty()
    @Matches(UUID_REGEX, { message: "deviceId must be a UUID" })
    deviceId!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    hostname!: string;

    @IsIn(["windows", "linux", "macos"])
    os!: "windows" | "linux" | "macos";

    @IsIn(["x64", "arm64", "x86"])
    arch!: "x64" | "arm64" | "x86";

    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    version!: string;
}
