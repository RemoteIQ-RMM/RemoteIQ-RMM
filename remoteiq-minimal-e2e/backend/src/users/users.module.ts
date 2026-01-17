// backend/src/users/users.module.ts
import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AuthModule } from "../auth/auth.module";

import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";

import { SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";

@Module({
    imports: [StorageModule, AuthModule],
    controllers: [UsersController, MeController, SecurityController],
    providers: [UsersService, MeService, SecurityService],
    exports: [UsersService, MeService, SecurityService],
})
export class UsersModule { }
