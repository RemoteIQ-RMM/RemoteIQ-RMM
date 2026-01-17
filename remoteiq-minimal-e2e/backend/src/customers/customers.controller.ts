import { Controller, Get, Param, Query } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { RequirePerm } from "../auth/require-perm.decorator";

@Controller("api/customers")
export class CustomersController {
    constructor(private readonly svc: CustomersService) { }

    @Get()
    @RequirePerm("customers.read")
    async listClients(@Query("q") q?: string) {
        return this.svc.listClients(q ?? "");
    }

    @Get(":client/sites")
    @RequirePerm("customers.read")
    async listSites(@Param("client") client: string) {
        return this.svc.listSitesForClient(client);
    }
}
