// FILE: remoteiq-frontend/app/customers/page.tsx

"use client";

import * as React from "react";
import {
    useDashboard,
    type Device,
    type DeviceStatus,
} from "@/app/(dashboard)/dashboard-context";
import { useCustomers } from "@/app/customers/customers-context";
import FiltersRail from "@/components/filters-rail";
import DeviceTable from "@/components/device-table";

import PermGate from "@/components/perm-gate";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    createCustomerClient,
    createCustomerSite,
    fetchCustomers,
    fetchCustomerSites,
    deleteCustomerClient,
    deleteCustomerSite,
    type CustomerClient,
} from "@/lib/api";

// --- normalization helpers ---
const normStatus = (s: unknown): DeviceStatus =>
    String(s ?? "").trim().toLowerCase() as DeviceStatus;
const normOs = (s: unknown): string => String(s ?? "").trim().toLowerCase();

const OS_MAP: Record<string, string> = {
    windows: "windows",
    "microsoft windows": "windows",
    linux: "linux",
    macos: "macos",
    "mac os": "macos",
    osx: "macos",
};
const toOsKey = (s: unknown) => OS_MAP[normOs(s)] ?? normOs(s);

function InlineEmptyState() {
    return (
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
            <h2 className="text-lg font-semibold">Select a customer or site</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Expand one or more customer/site groups in the sidebar to see their devices.
            </p>
        </div>
    );
}

type Flash = { kind: "success" | "error"; text: string } | null;

type SiteOption = { key: string; name: string };

function CustomersActions() {
    const [flash, setFlash] = React.useState<Flash>(null);

    const [createClientOpen, setCreateClientOpen] = React.useState(false);
    const [clientName, setClientName] = React.useState("");
    const [creatingClient, setCreatingClient] = React.useState(false);

    const [createSiteOpen, setCreateSiteOpen] = React.useState(false);
    const [siteName, setSiteName] = React.useState("");
    const [siteClientId, setSiteClientId] = React.useState<string>("");
    const [creatingSite, setCreatingSite] = React.useState(false);

    const [deleteOpen, setDeleteOpen] = React.useState(false);
    const [deleteMode, setDeleteMode] = React.useState<"client" | "site">("client");
    const [deleteClientId, setDeleteClientId] = React.useState<string>("");
    const [deleteSiteId, setDeleteSiteId] = React.useState<string>("");
    const [sites, setSites] = React.useState<SiteOption[]>([]);
    const [sitesLoading, setSitesLoading] = React.useState(false);
    const [deleting, setDeleting] = React.useState(false);

    const [clients, setClients] = React.useState<CustomerClient[]>([]);
    const [clientsLoading, setClientsLoading] = React.useState(false);

    const emitCustomersChanged = React.useCallback(() => {
        try {
            window.dispatchEvent(new CustomEvent("remoteiq:customers-changed"));
        } catch {
            // ignore
        }
    }, []);

    const refreshClients = React.useCallback(async () => {
        setClientsLoading(true);
        try {
            const list = await fetchCustomers();
            setClients(list ?? []);
            // keep selection stable, but if empty selection pick first
            if (!siteClientId && list?.[0]?.key) setSiteClientId(list[0].key);
            if (!deleteClientId && list?.[0]?.key) setDeleteClientId(list[0].key);
        } catch (e: any) {
            setFlash({ kind: "error", text: e?.message || "Failed to load customers." });
        } finally {
            setClientsLoading(false);
        }
    }, [siteClientId, deleteClientId]);

    const refreshSitesForDeleteClient = React.useCallback(
        async (clientKey: string) => {
            if (!clientKey || clientKey === "__none") {
                setSites([]);
                setDeleteSiteId("");
                return;
            }

            setSitesLoading(true);
            try {
                const res = await fetchCustomerSites(clientKey);
                const normalized: SiteOption[] = (res ?? []).map((s: any) => ({
                    key: String(s.key ?? s.id ?? ""),
                    name: String(s.name ?? s.label ?? ""),
                })).filter((s) => s.key && s.name);

                setSites(normalized);
                if (normalized.length > 0) setDeleteSiteId(normalized[0].key);
                else setDeleteSiteId("");
            } catch (e: any) {
                setSites([]);
                setDeleteSiteId("");
                setFlash({ kind: "error", text: e?.message || "Failed to load sites." });
            } finally {
                setSitesLoading(false);
            }
        },
        []
    );

    // Load customers when the site dialog opens
    React.useEffect(() => {
        if (createSiteOpen) void refreshClients();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createSiteOpen]);

    // Load customers when delete dialog opens (and clear mode-specific state)
    React.useEffect(() => {
        if (!deleteOpen) return;
        void refreshClients();
        setFlash(null);

        // reset selections a bit (but keep if already set)
        if (deleteMode === "site") {
            void refreshSitesForDeleteClient(deleteClientId || siteClientId || "");
        } else {
            setSites([]);
            setDeleteSiteId("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteOpen]);

    // When switching delete mode, ensure needed data is loaded
    React.useEffect(() => {
        if (!deleteOpen) return;
        if (deleteMode === "site") {
            void refreshSitesForDeleteClient(deleteClientId || "");
        } else {
            setSites([]);
            setDeleteSiteId("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteMode]);

    // When delete client changes (site mode), load sites
    React.useEffect(() => {
        if (!deleteOpen) return;
        if (deleteMode !== "site") return;
        void refreshSitesForDeleteClient(deleteClientId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteClientId]);

    const submitCreateClient = async () => {
        const name = clientName.trim();
        if (!name) {
            setFlash({ kind: "error", text: "Client name is required." });
            return;
        }

        setCreatingClient(true);
        setFlash(null);
        try {
            const res = await createCustomerClient({ name });
            setFlash({ kind: "success", text: `Client created: ${res?.name || name}` });
            setClientName("");
            setCreateClientOpen(false);

            await refreshClients();
            emitCustomersChanged();
        } catch (e: any) {
            setFlash({ kind: "error", text: e?.message || "Create client failed." });
        } finally {
            setCreatingClient(false);
        }
    };

    const submitCreateSite = async () => {
        const name = siteName.trim();
        if (!siteClientId || siteClientId === "__none") {
            setFlash({ kind: "error", text: "Select a customer first." });
            return;
        }
        if (!name) {
            setFlash({ kind: "error", text: "Site name is required." });
            return;
        }

        setCreatingSite(true);
        setFlash(null);
        try {
            const res = await createCustomerSite(siteClientId, { name });
            setFlash({ kind: "success", text: `Site created: ${res?.name || name}` });
            setSiteName("");
            setCreateSiteOpen(false);

            // Keep clients list fresh
            await refreshClients();
            emitCustomersChanged();
        } catch (e: any) {
            setFlash({ kind: "error", text: e?.message || "Create site failed." });
        } finally {
            setCreatingSite(false);
        }
    };

    const submitDelete = async () => {
        setFlash(null);

        if (deleteMode === "client") {
            if (!deleteClientId || deleteClientId === "__none") {
                setFlash({ kind: "error", text: "Select a client to delete." });
                return;
            }
        } else {
            if (!deleteClientId || deleteClientId === "__none") {
                setFlash({ kind: "error", text: "Select a client first." });
                return;
            }
            if (!deleteSiteId || deleteSiteId === "__none") {
                setFlash({ kind: "error", text: "Select a site to delete." });
                return;
            }
        }

        setDeleting(true);
        try {
            if (deleteMode === "client") {
                await deleteCustomerClient(deleteClientId, { force: false });
                setFlash({ kind: "success", text: "Client deleted." });
            } else {
                await deleteCustomerSite(deleteClientId, deleteSiteId);
                setFlash({ kind: "success", text: "Site deleted." });
            }

            // Refresh dropdowns after delete
            await refreshClients();
            if (deleteMode === "site") {
                await refreshSitesForDeleteClient(deleteClientId);
            }

            emitCustomersChanged();
            setDeleteOpen(false);
        } catch (e: any) {
            // Expect backend 409 messages like:
            // "Client has sites..." or "Site has devices..."
            setFlash({
                kind: "error",
                text: e?.message || "Delete failed.",
            });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-3">
            {flash && (
                <div
                    className={[
                        "rounded-md border px-3 py-2 text-sm",
                        flash.kind === "success"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200"
                            : "border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200",
                    ].join(" ")}
                >
                    {flash.text}
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="text-base font-semibold">Customers</div>
                    <div className="text-sm text-muted-foreground">
                        Create customers and sites (devices appear once endpoints check in).
                    </div>
                </div>

                <PermGate
                    require="customers.write"
                    title="No permission"
                    message="You don’t have permission to create or delete customers/sites."
                >
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Create Client */}
                        <Dialog open={createClientOpen} onOpenChange={setCreateClientOpen}>
                            <DialogTrigger asChild>
                                <Button variant="success">Create Client</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Client</DialogTitle>
                                    <DialogDescription>
                                        Adds a new client to the database.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-2">
                                    <div className="grid gap-2">
                                        <Label htmlFor="new-client-name">Client name</Label>
                                        <Input
                                            id="new-client-name"
                                            value={clientName}
                                            onChange={(e) => setClientName(e.target.value)}
                                            placeholder="e.g., STARK Industries"
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button
                                        variant="outline"
                                        type="button"
                                        onClick={() => setCreateClientOpen(false)}
                                        disabled={creatingClient}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="success"
                                        type="button"
                                        onClick={submitCreateClient}
                                        disabled={creatingClient}
                                    >
                                        {creatingClient ? "Creating..." : "Create"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        {/* Create Site */}
                        <Dialog open={createSiteOpen} onOpenChange={setCreateSiteOpen}>
                            <DialogTrigger asChild>
                                <Button>Create Site</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Site</DialogTitle>
                                    <DialogDescription>
                                        Adds a site under a specific client.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-2">
                                    <div className="grid gap-2">
                                        <Label>Client</Label>
                                        <Select value={siteClientId} onValueChange={setSiteClientId}>
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={clientsLoading ? "Loading..." : "Select a client"}
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {clients.map((c) => (
                                                    <SelectItem key={c.key} value={c.key}>
                                                        {c.name}
                                                    </SelectItem>
                                                ))}
                                                {clients.length === 0 && (
                                                    <SelectItem value="__none" disabled>
                                                        No clients found
                                                    </SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="grid gap-2">
                                        <Label htmlFor="new-site-name">Site name</Label>
                                        <Input
                                            id="new-site-name"
                                            value={siteName}
                                            onChange={(e) => setSiteName(e.target.value)}
                                            placeholder="e.g., Huber Heights"
                                        />
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button
                                        variant="outline"
                                        type="button"
                                        onClick={() => setCreateSiteOpen(false)}
                                        disabled={creatingSite}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        onClick={submitCreateSite}
                                        disabled={creatingSite || !siteClientId || siteClientId === "__none"}
                                    >
                                        {creatingSite ? "Creating..." : "Create"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        {/* Delete */}
                        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                            <DialogTrigger asChild>
                                <Button variant="destructive">Delete</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Delete client or site</DialogTitle>
                                    <DialogDescription>
                                        You can only delete a client if it has no sites (and no devices/tickets),
                                        and only delete a site if it has no devices/tickets.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-2">
                                    <div className="grid gap-2">
                                        <Label>Delete type</Label>
                                        <Select
                                            value={deleteMode}
                                            onValueChange={(v) => setDeleteMode(v as "client" | "site")}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="client">Client</SelectItem>
                                                <SelectItem value="site">Site</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="grid gap-2">
                                        <Label>Client</Label>
                                        <Select value={deleteClientId} onValueChange={setDeleteClientId}>
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={clientsLoading ? "Loading..." : "Select a client"}
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {clients.map((c) => (
                                                    <SelectItem key={c.key} value={c.key}>
                                                        {c.name}
                                                    </SelectItem>
                                                ))}
                                                {clients.length === 0 && (
                                                    <SelectItem value="__none" disabled>
                                                        No clients found
                                                    </SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {deleteMode === "site" && (
                                        <div className="grid gap-2">
                                            <Label>Site</Label>
                                            <Select
                                                value={deleteSiteId}
                                                onValueChange={setDeleteSiteId}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={
                                                            sitesLoading ? "Loading..." : "Select a site"
                                                        }
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sites.map((s) => (
                                                        <SelectItem key={s.key} value={s.key}>
                                                            {s.name}
                                                        </SelectItem>
                                                    ))}
                                                    {sites.length === 0 && (
                                                        <SelectItem value="__none" disabled>
                                                            No sites found
                                                        </SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>

                                <DialogFooter>
                                    <Button
                                        variant="outline"
                                        type="button"
                                        onClick={() => setDeleteOpen(false)}
                                        disabled={deleting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        type="button"
                                        onClick={submitDelete}
                                        disabled={
                                            deleting ||
                                            !deleteClientId ||
                                            deleteClientId === "__none" ||
                                            (deleteMode === "site" &&
                                                (!deleteSiteId || deleteSiteId === "__none"))
                                        }
                                    >
                                        {deleting ? "Deleting..." : "Delete"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </PermGate>
            </div>
        </div>
    );
}

export default function CustomersPage() {
    const {
        masterDevices,

        // table state (participates in Saved Views)
        sorting,
        setSorting,
        columnVisibility,
        setColumnVisibility,
        columnFilters,
        setColumnFilters,

        // Saved Views snapshot registrar
        registerSnapshotGetter,

        // global filters
        activeFilters,
    } = useDashboard();

    const { customersGroupOpen, expandedOrganizations, expandedSites } = useCustomers();

    // Register a snapshot getter so Saved Views capture Customers scope + table state + filters
    React.useEffect(() => {
        const off = registerSnapshotGetter(() => ({
            columnVisibility,
            sorting,
            columnFilters,

            // Customers bits:
            customersGroupOpen,
            expandedOrganizations: Array.from(expandedOrganizations),
            expandedSites: Array.from(expandedSites),
            activeFilters,
        }));
        return () => {
            registerSnapshotGetter(null);
            void off;
        };
    }, [
        registerSnapshotGetter,
        columnVisibility,
        sorting,
        columnFilters,
        customersGroupOpen,
        expandedOrganizations,
        expandedSites,
        activeFilters,
    ]);

    const nothingExpanded =
        customersGroupOpen && expandedOrganizations.size === 0 && expandedSites.size === 0;

    const statusFilterSet = React.useMemo(() => {
        const arr = activeFilters.status ?? [];
        return new Set(arr.map(normStatus));
    }, [activeFilters.status]);

    const osFilterSet = React.useMemo(() => {
        const arr = activeFilters.os ?? [];
        return new Set(arr.map(toOsKey));
    }, [activeFilters.os]);

    const matchesStatus = React.useCallback(
        (d: Device) => {
            if (!statusFilterSet.size) return true;
            return statusFilterSet.has(normStatus(d.status));
        },
        [statusFilterSet]
    );

    const matchesOs = React.useCallback(
        (d: Device) => {
            if (!osFilterSet.size) return true;
            return osFilterSet.has(toOsKey(d.os));
        },
        [osFilterSet]
    );

    const matchesSidebarScope = React.useCallback(
        (d: Device) => {
            if (expandedOrganizations.size === 0 && expandedSites.size === 0) return false;

            const orgSelected =
                expandedOrganizations.size > 0 ? expandedOrganizations.has(d.client) : false;

            const siteSelected = expandedSites.size > 0 ? expandedSites.has(d.site) : false;

            if (expandedSites.size > 0) {
                const orgGate = expandedOrganizations.size > 0 ? orgSelected : true;
                return siteSelected && orgGate;
            }

            if (expandedOrganizations.size > 0) {
                return orgSelected;
            }

            return false;
        },
        [expandedOrganizations, expandedSites]
    );

    const filteredForView = React.useMemo(() => {
        return masterDevices.filter((d) => matchesSidebarScope(d) && matchesOs(d) && matchesStatus(d));
    }, [masterDevices, matchesSidebarScope, matchesOs, matchesStatus]);

    return (
        <main className="grid grid-cols-12 gap-4 p-4 sm:px-6 sm:py-0">
            <section className="col-span-12 pt-4">
                <CustomersActions />
            </section>

            {nothingExpanded ? (
                <section className="col-span-12 pt-2">
                    <InlineEmptyState />
                </section>
            ) : (
                <>
                    <aside className="col-span-12 md:col-span-3 lg:col-span-2 pt-2">
                        <FiltersRail />
                    </aside>
                    <section className="col-span-12 md:col-span-9 lg:col-span-10 pt-2 min-w-0">
                        <DeviceTable
                            dataOverride={filteredForView}
                            filterColumnId="hostname"
                            filterPlaceholder="Filter devices…"
                            compact={false}
                        />
                    </section>
                </>
            )}
        </main>
    );
}
