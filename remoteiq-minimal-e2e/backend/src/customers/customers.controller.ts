// backend/src/customers/customers.controller.ts

import { Controller, Get, Param, Query } from "@nestjs/common";
import { CustomersService } from "./customers.service";

@Controller("api/customers")
export class CustomersController {
    constructor(private readonly svc: CustomersService) { }

    /**
     * GET /api/customers
     * Returns clients (from public.clients if present).
     * Optional ?q=term to filter (case-insensitive).
     *
     * Response:
     * [{ key: <clientId>, name: <clientName>, counts: { sites, devices, tickets } }]
     */
    @Get()
    async listClients(@Query("q") q?: string) {
        return this.svc.listClients(q ?? "");
    }

    /**
     * GET /api/customers/:client/sites
     * :client may be a client UUID (preferred) OR a client name (resolved to id).
     *
     * Response:
     * [{ key: <siteId>, name: <siteName>, counts: { devices, tickets } }]
     */
    @Get(":client/sites")
    async listSites(@Param("client") client: string) {
        return this.svc.listSitesForClient(client);
    }
}
