import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
} from "@nestjs/common";
import { RolesService } from "./roles.service";
import { CreateRoleDto, UpdateRoleDto } from "./dto";
import { RequirePerm } from "../auth/require-perm.decorator";

@Controller("/api/roles")
export class RolesController {
    constructor(private readonly svc: RolesService) { }

    @Get()
    @RequirePerm("roles.read")
    list() {
        return this.svc.list();
    }

    @Post()
    @RequirePerm("roles.write")
    create(@Body() body: CreateRoleDto) {
        return this.svc.create(body);
    }

    @Patch(":id")
    @RequirePerm("roles.write")
    async update(
        @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
        @Body() body: UpdateRoleDto
    ) {
        await this.svc.update(id, body);
        return { ok: true };
    }

    @Delete(":id")
    @RequirePerm("roles.delete")
    async remove(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
        await this.svc.remove(id);
        return { ok: true };
    }
}
