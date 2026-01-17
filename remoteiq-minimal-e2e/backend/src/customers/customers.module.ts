// backend/src/customers/customers.module.ts
import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { StorageModule } from "../storage/storage.module";

@Module({
    imports: [StorageModule],
    controllers: [CustomersController],
    providers: [CustomersService],
    exports: [CustomersService],
})
export class CustomersModule { }
