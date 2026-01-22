// FILE: remoteiq-minimal-e2e/backend/src/customers/customers.controller.ts

import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
    Req,
} from "@nestjs/common";
import type { Request } from "express";
import { CustomersService } from "./customers.service";
import { RequirePerm } from "../auth/require-perm.decorator";

type CreateClientDto = {
    name: string;
    labels?: any;
};

type CreateSiteDto = {
    name: string;
    labels?: any;
};

function getOrgId(req: Request): string | null {
    const u = (req as any)?.user;
    const org = u?.organizationId ?? u?.org ?? null;
    return org ? String(org) : null;
}

@Controller("api/customers")
export class CustomersController {
    constructor(private readonly svc: CustomersService) { }

    @Get()
    @RequirePerm("customers.read")
    async listClients(@Req() req: Request, @Query("q") q?: string) {
        return this.svc.listClients(q ?? "", getOrgId(req));
    }

    // ✅ Create client
    @Post()
    @RequirePerm("customers.write")
    async createClient(@Req() req: Request, @Body() body: CreateClientDto) {
        return this.svc.createClient(body, getOrgId(req));
    }

    @Get(":client/sites")
    @RequirePerm("customers.read")
    async listSites(@Req() req: Request, @Param("client") client: string) {
        return this.svc.listSitesForClient(client, getOrgId(req));
    }

    // ✅ Create site for client
    @Post(":client/sites")
    @RequirePerm("customers.write")
    async createSite(
        @Req() req: Request,
        @Param("client") client: string,
        @Body() body: CreateSiteDto
    ) {
        return this.svc.createSiteForClient(client, body, getOrgId(req));
    }

    // ✅ Delete a site under a client (site can be UUID or name within that client)
    @Delete(":client/sites/:site")
    @RequirePerm("customers.write")
    async deleteSite(
        @Req() req: Request,
        @Param("client") client: string,
        @Param("site") site: string
    ) {
        return this.svc.deleteSiteForClient(client, site, getOrgId(req));
    }

    // ✅ Delete a client
    // ?force=true will delete empty sites then the client (but refuses if devices/tickets exist)
    @Delete(":client")
    @RequirePerm("customers.write")
    async deleteClient(
        @Req() req: Request,
        @Param("client") client: string,
        @Query("force") force?: string
    ) {
        const doForce = String(force ?? "").toLowerCase() === "true";
        return this.svc.deleteClient(client, { force: doForce }, getOrgId(req));
    }
}
