import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    UseGuards,
} from "@nestjs/common";
import { StorageConnectionsService } from "./storage-connections.service";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerm } from "../auth/require-perm.decorator";

@Controller("/api/admin/storage")
@UseGuards(PermissionsGuard)
export class StorageController {
    constructor(private readonly svc: StorageConnectionsService) { }

    @Get("connections")
    @RequirePerm("backups.manage")
    async list() {
        return this.svc.list();
    }

    @Post("connections")
    @RequirePerm("backups.manage")
    async create(@Body() body: any) {
        return this.svc.create(body);
    }

    @Put("connections/:id")
    @RequirePerm("backups.manage")
    async update(@Param("id") id: string, @Body() body: any) {
        await this.svc.update(id, body);
        return { ok: true };
    }

    @Delete("connections/:id")
    @RequirePerm("backups.manage")
    async remove(@Param("id") id: string) {
        await this.svc.delete(id);
        return { ok: true };
    }

    @Get("connections/:id/dependents")
    @RequirePerm("backups.manage")
    async dependents(@Param("id") id: string) {
        return this.svc.getDependents(id);
    }

    @Post("test")
    @RequirePerm("backups.manage")
    async test(@Body() body: any) {
        return this.svc.test(body);
    }

    @Post("browse")
    @RequirePerm("backups.manage")
    async browse(@Body() body: any) {
        return this.svc.browseNextcloud(body);
    }
}
