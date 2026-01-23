import { Module } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { EndpointsController } from "./endpoints.controller";
import { EndpointsService } from "./endpoints.service";

@Module({
    controllers: [EndpointsController],
    providers: [EndpointsService, PgPoolService],
})
export class EndpointsModule { }
