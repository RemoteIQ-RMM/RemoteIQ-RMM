import { Controller, Get, Param, Query } from "@nestjs/common";
import { CustomersService } from "./customers.service";

@Controller("api/customers")
export class CustomersController {
    constructor(private readonly svc: CustomersService) { }

    /**
     * GET /api/customers
     * Returns distinct clients from tickets + devices.
     * Optional ?q=term to filter (case-insensitive).
     */
    @Get()
    async listClients(@Query("q") q?: string) {
        return this.svc.listClients(q ?? "");
    }

    /**
     * GET /api/customers/:client/sites
     * Returns distinct sites for the given client (from tickets + devices).
     */
    @Get(":client/sites")
    async listSites(@Param("client") client: string) {
        return this.svc.listSitesForClient(client);
    }
}
