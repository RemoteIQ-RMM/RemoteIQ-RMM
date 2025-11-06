//backend\src\storage\storage.module.ts

import { Module } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "../auth/permissions.guard";
import { PgBootstrap } from "./pg.bootstrap";
import { OrganizationContextService } from "./organization-context.service";
import { PgPoolService } from "./pg-pool.service";
import { StorageConnectionsService } from "./storage-connections.service";
import { StorageController } from "./storage.controller";

@Module({
    controllers: [StorageController],
    providers: [
        PgPoolService,
        PgBootstrap,
        OrganizationContextService,
        StorageConnectionsService,
        PermissionsGuard,
        Reflector,
    ],
    exports: [PgPoolService, OrganizationContextService, StorageConnectionsService],
})
export class StorageModule { }
