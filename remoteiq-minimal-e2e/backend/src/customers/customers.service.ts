import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

type Row = { name: string; source: "tickets" | "devices"; count: number };

@Injectable()
export class CustomersService {
    constructor(private readonly db: PgPoolService) { }

    async listClients(q: string) {
        // Gather distinct client names from both places, ignore blanks/nulls
        const sql = `
      with clients as (
        select 'devices'::text as source, nullif(trim(client),'') as name, count(*) as count
        from devices
        where nullif(trim(client),'') is not null
        group by 1,2
        union all
        select 'tickets'::text as source, nullif(trim(client),'') as name, count(*) as count
        from tickets
        where nullif(trim(client),'') is not null
        group by 1,2
      )
      select lower(name) as key,
             name,
             jsonb_object_agg(source, count) filter (where name is not null) as counts
      from clients
      ${q ? "where lower(name) like lower($1)" : ""}
      group by name
      order by lower(name)
    `;
        const args = q ? [`%${q}%`] : [];
        const { rows } = await this.db.query(sql, args);
        // Shape: [{ key, name, counts: { devices?:n, tickets?:n } }]
        return rows.map((r: any) => ({
            key: r.key as string,
            name: r.name as string,
            counts: r.counts ?? {},
        }));
    }

    async listSitesForClient(client: string) {
        // Return distinct sites for this client from both tables
        const sql = `
      with sites as (
        select 'devices'::text as source, nullif(trim(site),'') as name, count(*) as count
        from devices
        where nullif(trim(site),'') is not null and client = $1
        group by 1,2
        union all
        select 'tickets'::text as source, nullif(trim(site),'') as name, count(*) as count
        from tickets
        where nullif(trim(site),'') is not null and client = $1
        group by 1,2
      )
      select lower(name) as key,
             name,
             jsonb_object_agg(source, count) filter (where name is not null) as counts
      from sites
      group by name
      order by lower(name)
    `;
        const { rows } = await this.db.query(sql, [client]);
        return rows.map((r: any) => ({
            key: r.key as string,
            name: r.name as string,
            counts: r.counts ?? {},
        }));
    }
}
