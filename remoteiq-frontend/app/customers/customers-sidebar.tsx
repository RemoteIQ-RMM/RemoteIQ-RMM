// app/customers/customers-sidebar.tsx
"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomers } from "./customers-context";
import {
    CUSTOMERS_CHANGED_EVENT,
    fetchCustomers,
    fetchCustomerSites,
    type CustomerClient,
    type CustomerSite,
} from "@/lib/api";

/**
 * Customers Sidebar
 * - Shows customers + sites even if 0 devices (pulls from API)
 * - Badges still show endpoint counts derived from masterDevices
 * - Lazily loads sites for a customer when expanded
 */

type SitesByOrgName = Record<string, string[]>;

export default function CustomersSidebar() {
    const router = useRouter();
    const pathname = usePathname();

    const {
        customersGroupOpen,
        toggleCustomersGroup,
        expandedOrganizations,
        expandedSites,
        onExpandChange,
        masterDevices,
    } = useCustomers();

    // -----------------------------
    // Device-derived counts (badges)
    // -----------------------------
    const {
        deviceOrgs,
        deviceSitesByOrg,
        siteDeviceCounts,
        orgDeviceCounts,
        totalEndpoints,
    } = React.useMemo(() => {
        const orgSet = new Set<string>();
        const sitesMap: Record<string, string[]> = {};
        const siteCounts: Record<string, Record<string, number>> = {};
        const orgCounts: Record<string, number> = {};
        let total = 0;

        for (const d of masterDevices) {
            total += 1;

            const org = String(d.client ?? "").trim();
            const site = String(d.site ?? "").trim();

            if (!org) continue;
            orgSet.add(org);

            // sites per org
            if (site) {
                if (!sitesMap[org]) sitesMap[org] = [];
                if (!sitesMap[org].includes(site)) sitesMap[org].push(site);

                // site endpoint counts
                if (!siteCounts[org]) siteCounts[org] = {};
                siteCounts[org][site] = (siteCounts[org][site] ?? 0) + 1;
            }

            // org endpoint counts
            orgCounts[org] = (orgCounts[org] ?? 0) + 1;
        }

        const sortedOrgs = Array.from(orgSet).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        for (const org of Object.keys(sitesMap)) {
            sitesMap[org].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: "base" })
            );
        }

        return {
            deviceOrgs: sortedOrgs,
            deviceSitesByOrg: sitesMap,
            siteDeviceCounts: siteCounts,
            orgDeviceCounts: orgCounts,
            totalEndpoints: total,
        };
    }, [masterDevices]);

    // -----------------------------
    // API-derived customers + sites
    // -----------------------------
    const [clients, setClients] = React.useState<CustomerClient[]>([]);
    const [clientsLoading, setClientsLoading] = React.useState(false);

    // Cache sites by ORG NAME (because your expansion/filter logic is name-based)
    const [sitesByOrgName, setSitesByOrgName] = React.useState<SitesByOrgName>({});
    const [sitesLoadingByOrgName, setSitesLoadingByOrgName] = React.useState<Record<string, boolean>>(
        {}
    );

    const clientsByName = React.useMemo(() => {
        const map = new Map<string, CustomerClient>();
        for (const c of clients) {
            const name = String(c.name ?? "").trim();
            if (name) map.set(name.toLowerCase(), c);
        }
        return map;
    }, [clients]);

    const refreshClients = React.useCallback(async () => {
        setClientsLoading(true);
        try {
            const list = await fetchCustomers();
            const sorted = [...(list ?? [])].sort((a, b) =>
                String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
                    sensitivity: "base",
                })
            );
            setClients(sorted);
        } finally {
            setClientsLoading(false);
        }
    }, []);

    React.useEffect(() => {
        void refreshClients();

        // refresh when a client/site is created
        const onChanged = () => {
            setSitesByOrgName({});
            void refreshClients();
        };

        if (typeof window !== "undefined") {
            window.addEventListener(CUSTOMERS_CHANGED_EVENT, onChanged as any);
            return () => window.removeEventListener(CUSTOMERS_CHANGED_EVENT, onChanged as any);
        }
        return;
    }, [refreshClients]);

    const ensureSitesLoaded = React.useCallback(
        async (orgName: string) => {
            const key = String(orgName ?? "").trim();
            if (!key) return;

            if (sitesByOrgName[key]) return; // already loaded
            if (sitesLoadingByOrgName[key]) return;

            const client = clientsByName.get(key.toLowerCase());
            if (!client?.id) {
                // No matching client record (yet); fall back to device-derived sites only
                setSitesByOrgName((prev) => ({
                    ...prev,
                    [key]: deviceSitesByOrg[key] ?? [],
                }));
                return;
            }

            setSitesLoadingByOrgName((prev) => ({ ...prev, [key]: true }));
            try {
                const sites: CustomerSite[] = await fetchCustomerSites(client.id);
                const names = (sites ?? [])
                    .map((s) => String(s.name ?? "").trim())
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

                setSitesByOrgName((prev) => ({
                    ...prev,
                    [key]: names,
                }));
            } finally {
                setSitesLoadingByOrgName((prev) => ({ ...prev, [key]: false }));
            }
        },
        [clientsByName, deviceSitesByOrg, sitesByOrgName, sitesLoadingByOrgName]
    );

    // Determine which org list to show:
    // - Prefer API clients (so empty customers show)
    // - Also include any orgs that exist in devices but not in API list (defensive)
    const orgs = React.useMemo(() => {
        const apiNames = clients
            .map((c) => String(c.name ?? "").trim())
            .filter(Boolean);

        const set = new Set<string>(apiNames);
        for (const dOrg of deviceOrgs) set.add(dOrg);

        return Array.from(set).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
    }, [clients, deviceOrgs]);

    const goCustomers = React.useCallback(() => {
        if (!customersGroupOpen) toggleCustomersGroup(true);
        if (pathname !== "/customers") router.push("/customers");
    }, [customersGroupOpen, pathname, router, toggleCustomersGroup]);

    // a11y: keyboard toggle helpers for org/site rows
    const onKeyToggle =
        (fn: () => void) =>
            (e: React.KeyboardEvent<HTMLButtonElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fn();
                }
            };

    const onToggleOrg = React.useCallback(
        async (orgName: string, nextExpanded: boolean) => {
            const org = String(orgName ?? "").trim();
            if (!org) return;

            if (nextExpanded) {
                // pre-load sites so the subtree is correct immediately
                void ensureSitesLoaded(org);
            }

            const childSites =
                sitesByOrgName[org] ??
                deviceSitesByOrg[org] ??
                [];

            onExpandChange("organization", org, nextExpanded, childSites);
        },
        [deviceSitesByOrg, ensureSitesLoaded, onExpandChange, sitesByOrgName]
    );

    return (
        <aside
            className="w-64 shrink-0 border-r bg-background"
            aria-label="Customers sidebar"
            style={{ height: "calc(100vh - 56px)" }} // below fixed TopBar (56px tall)
        >
            <div className="p-2 text-sm" role="tree" aria-label="Customers Tree">
                {/* Root */}
                <button
                    type="button"
                    role="treeitem"
                    aria-level={1}
                    aria-selected={pathname === "/customers"}
                    aria-expanded={customersGroupOpen}
                    onClick={goCustomers}
                    onKeyDown={onKeyToggle(goCustomers)}
                    className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground",
                        pathname === "/customers" && "bg-accent"
                    )}
                    title="Customers"
                    aria-controls="customers-tree-root"
                >
                    <ChevronRight
                        className={cn(
                            "h-4 w-4 transition-transform",
                            customersGroupOpen && "rotate-90"
                        )}
                        aria-hidden="true"
                    />
                    <span className="font-medium">Customers</span>
                    <span className="ml-auto rounded bg-muted px-1.5 text-xs text-muted-foreground">
                        {totalEndpoints}
                    </span>
                </button>

                <div
                    id="customers-tree-root"
                    role="group"
                    className={cn("mt-1 pl-5", !customersGroupOpen && "hidden")}
                >
                    {customersGroupOpen && (
                        <>
                            {clientsLoading && (
                                <div className="px-2 py-1 text-xs text-muted-foreground">
                                    Loading customers…
                                </div>
                            )}

                            {!clientsLoading && orgs.length === 0 && (
                                <div className="px-2 py-1 text-xs text-muted-foreground">
                                    No customers yet
                                </div>
                            )}

                            {!clientsLoading &&
                                orgs.map((org) => {
                                    const orgName = String(org ?? "").trim();
                                    const isOrgExpanded = expandedOrganizations.has(orgName);
                                    const orgGroupId = `org-${encodeURIComponent(orgName)}`;

                                    const orgCount = orgDeviceCounts[orgName] ?? 0;

                                    const sites =
                                        sitesByOrgName[orgName] ??
                                        deviceSitesByOrg[orgName] ??
                                        [];

                                    return (
                                        <div key={orgName} className="mb-1">
                                            <button
                                                type="button"
                                                role="treeitem"
                                                aria-level={2}
                                                aria-selected={isOrgExpanded}
                                                aria-expanded={isOrgExpanded}
                                                aria-controls={orgGroupId}
                                                onClick={() => void onToggleOrg(orgName, !isOrgExpanded)}
                                                onKeyDown={onKeyToggle(() =>
                                                    void onToggleOrg(orgName, !isOrgExpanded)
                                                )}
                                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                                                title={orgName}
                                            >
                                                <ChevronRight
                                                    className={cn(
                                                        "h-4 w-4 transition-transform",
                                                        isOrgExpanded && "rotate-90"
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                <span className="truncate">{orgName}</span>
                                                <span className="ml-auto rounded bg-muted px-1.5 text-xs text-muted-foreground">
                                                    {orgCount}
                                                </span>
                                            </button>

                                            <div
                                                id={orgGroupId}
                                                role="group"
                                                className={cn("mt-1 pl-5", !isOrgExpanded && "hidden")}
                                            >
                                                {isOrgExpanded && (
                                                    <>
                                                        {sitesLoadingByOrgName[orgName] && sites.length === 0 && (
                                                            <div className="px-2 py-1 text-xs text-muted-foreground">
                                                                Loading sites…
                                                            </div>
                                                        )}

                                                        {sites.map((site) => {
                                                            const siteName = String(site ?? "").trim();
                                                            const isSiteExpanded = expandedSites.has(siteName);
                                                            const count = siteDeviceCounts[orgName]?.[siteName] ?? 0;

                                                            const siteId = `site-${encodeURIComponent(orgName)}-${encodeURIComponent(
                                                                siteName
                                                            )}`;

                                                            return (
                                                                <button
                                                                    key={siteName}
                                                                    type="button"
                                                                    role="treeitem"
                                                                    aria-level={3}
                                                                    aria-selected={isSiteExpanded}
                                                                    aria-expanded={isSiteExpanded}
                                                                    aria-controls={siteId}
                                                                    onClick={() =>
                                                                        onExpandChange("site", siteName, !isSiteExpanded)
                                                                    }
                                                                    onKeyDown={onKeyToggle(() =>
                                                                        onExpandChange("site", siteName, !isSiteExpanded)
                                                                    )}
                                                                    className={cn(
                                                                        "flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground",
                                                                        isSiteExpanded && "bg-accent/40"
                                                                    )}
                                                                    title={siteName}
                                                                >
                                                                    <ChevronRight
                                                                        className={cn(
                                                                            "h-4 w-4 transition-transform",
                                                                            isSiteExpanded && "rotate-90"
                                                                        )}
                                                                        aria-hidden="true"
                                                                    />
                                                                    <span className="truncate">{siteName}</span>
                                                                    <span className="ml-auto rounded bg-muted px-1.5 text-xs text-muted-foreground">
                                                                        {count}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}

                                                        {!sitesLoadingByOrgName[orgName] && sites.length === 0 && (
                                                            <div className="px-2 py-1 text-xs text-muted-foreground">
                                                                No sites yet
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </>
                    )}
                </div>
            </div>
        </aside>
    );
}
