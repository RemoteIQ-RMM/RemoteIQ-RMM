// backend/src/customers/customers.module.ts

import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { PgPoolService } from "../storage/pg-pool.service";

@Module({
    controllers: [CustomersController],
    providers: [CustomersService, PgPoolService],
})
export class CustomersModule { }
