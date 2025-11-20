import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import {
    BulkInviteDto,
    CreateUserDto,
    IdParam,
    InviteUserDto,
    ListUsersQuery,
    ResetPasswordDto,
    SuspendDto,
    UpdateRoleDto,
    UpdateUserDto,
} from "./users.dto";
import { UsersService } from "./users.service";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/admin/users")
export class UsersController {
    constructor(private readonly svc: UsersService) { }

    @Get()
    async list(@Query() q: ListUsersQuery) {
        return this.svc.list(q);
    }

    @Get("roles")
    async roles() {
        return this.svc.roles();
    }

    @Post("invite")
    async invite(@Body() body: InviteUserDto) {
        return this.svc.inviteOne(body);
    }

    @Post("invite/bulk")
    async inviteBulk(@Body() body: BulkInviteDto) {
        return this.svc.inviteBulk(body);
    }

    @Post("create")
    async create(@Body() body: CreateUserDto) {
        return this.svc.createOne(body);
    }

    @Patch(":id/role")
    @HttpCode(204)
    async updateRole(@Param() p: IdParam, @Body() body: UpdateRoleDto) {
        await this.svc.updateRole(p.id, body);
    }

    @Patch(":id")
    @HttpCode(204)
    async updateUser(@Param() p: IdParam, @Body() body: UpdateUserDto) {
        await this.svc.updateUser(p.id, body);
    }

    // RESET PASSWORD — both PATCH and POST call the same service method
    @Patch(":id/password")
    @HttpCode(204)
    async resetPasswordPatch(@Param() p: IdParam, @Body() body: ResetPasswordDto) {
        await this.svc.setPassword(p.id, body);
    }

    @Post(":id/password")
    @HttpCode(204)
    async resetPasswordPost(@Param() p: IdParam, @Body() body: ResetPasswordDto) {
        await this.svc.setPassword(p.id, body);
    }

    @Post(":id/reset-2fa")
    @HttpCode(204)
    async reset2fa(@Param() p: IdParam) {
        await this.svc.reset2fa(p.id);
    }

    @Post(":id/suspend")
    @HttpCode(204)
    async suspend(@Param() p: IdParam, @Body() body: SuspendDto) {
        await this.svc.setSuspended(p.id, body.suspended);
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(@Param() p: IdParam) {
        await this.svc.remove(p.id);
    }
}
