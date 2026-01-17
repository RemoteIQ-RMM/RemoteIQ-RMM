import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { CompatController } from "./compat.controller";

@Module({
    imports: [
        StorageModule,
        AuthModule,
        UsersModule,
    ],
    controllers: [CompatController],
})
export class CompatModule { }
