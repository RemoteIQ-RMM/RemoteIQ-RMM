// backend/src/users/users.dto.ts
import {
    IsBoolean,
    IsEmail,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    MinLength,
} from "class-validator";
import { Type } from "class-transformer";

export type UserRoleSummary = { id: string; name: string };

export type UserRow = {
    id: string;
    name: string;
    email: string;
    role: string;
    roleId?: string | null;
    roles?: UserRoleSummary[];
    status: "active" | "suspended" | "invited";
    twoFactorEnabled: boolean;
    suspended?: boolean;
    lastSeen: string | null;
    createdAt: string;
    updatedAt: string;

    // Optional profile fields if present in DB (we don't require them)
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    postal?: string | null;
    country?: string | null;

    // Avatars (nullable; map from avatar_url / avatar_thumb_url)
    avatarUrl?: string | null;
    avatarThumbUrl?: string | null;
};

export class ListUsersQuery {
    @IsOptional() @IsString() q?: string;
    @IsOptional() @IsString() role?: string;

    @IsOptional() @IsIn(["all", "active", "suspended", "invited"])
    status: "all" | "active" | "suspended" | "invited" = "all";

    @IsOptional() @IsIn(["name", "email", "role", "lastSeen"])
    sortKey: "name" | "email" | "role" | "lastSeen" = "name";

    @IsOptional() @IsIn(["asc", "desc"])
    sortDir: "asc" | "desc" = "asc";

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page: number = 1;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    pageSize: number = 25;
}

export class InviteUserDto {
    @IsOptional() @IsString() name?: string;
    @IsEmail() email!: string;
    @IsOptional() @IsString() role?: string;
    @IsOptional() @IsString() message?: string;
}

export class BulkInviteDto {
    invites!: InviteUserDto[];
}

export class UpdateRoleDto {
    @IsString() role!: string;
}

export class IdParam {
    @IsUUID() id!: string;
}

export class SuspendDto {
    @IsBoolean() suspended!: boolean;
}

/* -------- Admin create + reset password -------- */
export class CreateUserDto {
    @IsString() @MinLength(1) name!: string;
    @IsEmail() email!: string;
    @IsOptional() @IsString() role?: string; // default "User"
    @IsString() @MinLength(8) password!: string;
    @IsOptional() @IsIn(["active", "invited", "suspended"])
    status?: "active" | "invited" | "suspended"; // default "active"
}

export class ResetPasswordDto {
    @IsString() @MinLength(8) password!: string;
}

/* -------- Update user details (only updates provided fields) -------- */
export class UpdateUserDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() role?: string;

    // Optional profile fields — updated only if present in DB
    @IsOptional() @IsString() phone?: string;
    @IsOptional() @IsString() address1?: string;
    @IsOptional() @IsString() address2?: string;
    @IsOptional() @IsString() city?: string;
    @IsOptional() @IsString() state?: string;
    @IsOptional() @IsString() postal?: string;
    @IsOptional() @IsString() country?: string;

    // If you decide to allow admin to set avatars here, keep these optional.
    @IsOptional() @IsString() avatarUrl?: string | null;
    @IsOptional() @IsString() avatarThumbUrl?: string | null;
}

/* ============================
   SELF PROFILE (current user)
   ============================ */

export class MeProfileDto {
    id!: string;
    name!: string;
    email!: string;

    @IsOptional() @IsString() phone?: string | null;
    @IsOptional() @IsString() timezone?: string | null;
    @IsOptional() @IsString() locale?: string | null;

    // Full-size avatar URL
    @IsOptional() @IsString() avatarUrl?: string | null;

    // Optional thumbnail URL if you generate/store one
    @IsOptional() @IsString() avatarThumbUrl?: string | null;

    // Address fields (kept optional for back-compat)
    @IsOptional() @IsString() address1?: string | null;
    @IsOptional() @IsString() address2?: string | null;
    @IsOptional() @IsString() city?: string | null;
    @IsOptional() @IsString() state?: string | null;
    @IsOptional() @IsString() postal?: string | null;
    @IsOptional() @IsString() country?: string | null;
}

export class UpdateMeDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() phone?: string | null;
    @IsOptional() @IsString() timezone?: string | null;
    @IsOptional() @IsString() locale?: string | null;

    @IsOptional() @IsString() avatarUrl?: string | null;
    @IsOptional() @IsString() avatarThumbUrl?: string | null;

    @IsOptional() @IsString() address1?: string | null;
    @IsOptional() @IsString() address2?: string | null;
    @IsOptional() @IsString() city?: string | null;
    @IsOptional() @IsString() state?: string | null;
    @IsOptional() @IsString() postal?: string | null;
    @IsOptional() @IsString() country?: string | null;
}
