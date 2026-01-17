// backend/src/storage/storage.module.ts
import { Module } from "@nestjs/common";

import { PgBootstrap } from "./pg.bootstrap";
import { OrganizationContextService } from "./organization-context.service";
import { PgPoolService } from "./pg-pool.service";
import { StorageConnectionsService } from "./storage-connections.service";
import { StorageController } from "./storage.controller";
import { StorageImportController } from "./storage-import.controller";

@Module({
    controllers: [StorageController, StorageImportController],
    providers: [
        PgPoolService,
        PgBootstrap,
        OrganizationContextService,
        StorageConnectionsService,
    ],
    exports: [
        PgPoolService,
        OrganizationContextService,
        StorageConnectionsService,
    ],
})
export class StorageModule { }
