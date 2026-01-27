import { Module } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { PatchesController } from "./patches.controller";
import { PatchesService } from "./patches.service";

@Module({
    controllers: [PatchesController],
    providers: [PgPoolService, PatchesService],
})
export class PatchesModule { }
