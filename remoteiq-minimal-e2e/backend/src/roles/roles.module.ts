import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { PermissionsIntrospectService } from './permissions-introspect.service';
import { RolesPermissionsController } from './permissions.controller';
import { PermissionsGuard } from '../auth/permissions.guard';

@Module({
    imports: [StorageModule],
    providers: [RolesService, PermissionsIntrospectService, PermissionsGuard],
    controllers: [RolesController, RolesPermissionsController],
    exports: [RolesService],
})
export class RolesModule { }
