import { Controller, Get, Query } from "@nestjs/common";
import { RequirePerm } from "../auth/require-perm.decorator";
import { UsersService } from "../users/users.service";

@Controller("/api")
export class CompatController {
    constructor(private readonly users: UsersService) { }

    /**
     * Ticketing UI expects GET /api/users (non-admin path).
     * We safely map it to the existing UsersService.list().
     */
    @Get("users")
    @RequirePerm("users.read")
    async usersList(
        @Query("q") q?: string,
    ) {
        // Minimal, safe defaults. Still org-scoped by OrganizationContextService.
        return this.users.list({
            q: q ?? "",
            status: "all",
            role: "all",
            sortKey: "name",
            sortDir: "ASC",
            page: 1,
            pageSize: 250,
        } as any);
    }

    /**
     * Ticketing UI expects these endpoints. Your policy currently has "customers.read"
     * (not clients.read/sites.read/locations.read), so we guard with customers.read
     * to keep security consistent without adding new perms right now.
     *
     * For now we return empty arrays (valid 200s) to stop retry loops.
     * Later we can wire these into whatever schema you’re using (organizations, sites, locations).
     */
    @Get("clients")
    @RequirePerm("customers.read")
    async clients() {
        return [];
    }

    @Get("sites")
    @RequirePerm("customers.read")
    async sites() {
        return [];
    }

    @Get("locations")
    @RequirePerm("customers.read")
    async locations() {
        return [];
    }
}
