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
    jfetch,
    createCustomerClient,
    createCustomerSite,
    fetchCustomers,
    fetchCustomerSites,
    deleteCustomerClient,
    deleteCustomerSite,
    type CustomerClient,
    getInstallerBundle,
    startBrowserDownload,
    type InstallerOs,
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

// Prefer IDs if present (new backend payload), otherwise fall back to display names
function getDeviceClientKey(d: Device): string {
    const anyD = d as any;
    return String(anyD?.clientId ?? d.client ?? "").trim();
}
function getDeviceSiteKey(d: Device): string {
    const anyD = d as any;
    return String(anyD?.siteId ?? d.site ?? "").trim();
}

// Backend DTO result for reusable enrollment key
type CreateEnrollmentKeyResult = {
    enrollmentKey: string; // raw token returned ONCE
    tokenId: string; // uuid
    expiresAt: string; // ISO
    clientId: string;
    siteId: string;
    name: string | null;
};

function CustomersActions() {
    const [flash, setFlash] = React.useState<Flash>(null);

    // -------------------------
    // Customers CRUD
    // -------------------------
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

    // -------------------------
    // Reusable Installer (Option A)
    // -------------------------
    const [installerOpen, setInstallerOpen] = React.useState(false);
    const [installerClientId, setInstallerClientId] = React.useState<string>("");
    const [installerSiteId, setInstallerSiteId] = React.useState<string>("");
    const [installerSites, setInstallerSites] = React.useState<SiteOption[]>([]);
    const [installerSitesLoading, setInstallerSitesLoading] = React.useState(false);

    const [installerOs, setInstallerOs] = React.useState<InstallerOs>("windows");

    const [keyName, setKeyName] = React.useState<string>("");
    const [keyExpiresMinutes, setKeyExpiresMinutes] = React.useState<string>("10080"); // 7 days default
    const [creatingKey, setCreatingKey] = React.useState(false);
    const [keyResult, setKeyResult] = React.useState<CreateEnrollmentKeyResult | null>(null);

    const [downloadingInstaller, setDownloadingInstaller] = React.useState<InstallerOs | null>(null);

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

            if (!siteClientId && list?.[0]?.key) setSiteClientId(list[0].key);
            if (!deleteClientId && list?.[0]?.key) setDeleteClientId(list[0].key);

            if (!installerClientId && list?.[0]?.key) setInstallerClientId(list[0].key);
        } catch (e: any) {
            setFlash({ kind: "error", text: e?.message || "Failed to load customers." });
        } finally {
            setClientsLoading(false);
        }
    }, [siteClientId, deleteClientId, installerClientId]);

    const refreshSitesForDeleteClient = React.useCallback(async (clientKey: string) => {
        if (!clientKey || clientKey === "__none") {
            setSites([]);
            setDeleteSiteId("");
            return;
        }

        setSitesLoading(true);
        try {
            const res = await fetchCustomerSites(clientKey);
            const normalized: SiteOption[] = (res ?? [])
                .map((s: any) => ({
                    key: String(s.key ?? s.id ?? ""),
                    name: String(s.name ?? s.label ?? ""),
                }))
                .filter((s) => s.key && s.name);

            setSites(normalized);
            setDeleteSiteId(normalized[0]?.key ?? "");
        } catch (e: any) {
            setSites([]);
            setDeleteSiteId("");
            setFlash({ kind: "error", text: e?.message || "Failed to load sites." });
        } finally {
            setSitesLoading(false);
        }
    }, []);

    const refreshInstallerSites = React.useCallback(
        async (clientKey: string) => {
            if (!clientKey || clientKey === "__none") {
                setInstallerSites([]);
                setInstallerSiteId("");
                return;
            }

            setInstallerSitesLoading(true);
            try {
                const res = await fetchCustomerSites(clientKey);
                const normalized: SiteOption[] = (res ?? [])
                    .map((s: any) => ({
                        key: String(s.key ?? s.id ?? ""),
                        name: String(s.name ?? s.label ?? ""),
                    }))
                    .filter((s) => s.key && s.name);

                setInstallerSites(normalized);

                if (normalized.length === 0) {
                    setInstallerSiteId("");
                } else {
                    const stillValid = normalized.some((x) => x.key === installerSiteId);
                    if (!installerSiteId || !stillValid) setInstallerSiteId(normalized[0].key);
                }
            } catch (e: any) {
                setInstallerSites([]);
                setInstallerSiteId("");
                setFlash({ kind: "error", text: e?.message || "Failed to load sites." });
            } finally {
                setInstallerSitesLoading(false);
            }
        },
        [installerSiteId]
    );

    React.useEffect(() => {
        if (createSiteOpen) void refreshClients();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [createSiteOpen]);

    React.useEffect(() => {
        if (!deleteOpen) return;
        void refreshClients();
        setFlash(null);

        if (deleteMode === "site") {
            void refreshSitesForDeleteClient(deleteClientId || siteClientId || "");
        } else {
            setSites([]);
            setDeleteSiteId("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteOpen]);

    React.useEffect(() => {
        if (!deleteOpen) return;
        if (deleteMode === "site") void refreshSitesForDeleteClient(deleteClientId || "");
        else {
            setSites([]);
            setDeleteSiteId("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteMode]);

    React.useEffect(() => {
        if (!deleteOpen) return;
        if (deleteMode !== "site") return;
        void refreshSitesForDeleteClient(deleteClientId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deleteClientId]);

    React.useEffect(() => {
        if (!installerOpen) return;

        void refreshClients();
        setFlash(null);
        setKeyResult(null);
        setKeyName("");
        setKeyExpiresMinutes("10080");

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [installerOpen]);

    React.useEffect(() => {
        if (!installerOpen) return;
        if (!installerClientId) return;
        void refreshInstallerSites(installerClientId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [installerClientId, installerOpen]);

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

            await refreshClients();
            if (deleteMode === "site") await refreshSitesForDeleteClient(deleteClientId);

            emitCustomersChanged();
            setDeleteOpen(false);
        } catch (e: any) {
            setFlash({ kind: "error", text: e?.message || "Delete failed." });
        } finally {
            setDeleting(false);
        }
    };

    const copy = React.useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setFlash({ kind: "success", text: "Copied to clipboard." });
        } catch {
            setFlash({ kind: "error", text: "Copy failed." });
        }
    }, []);

    const submitCreateEnrollmentKey = async () => {
        setFlash(null);

        const clientId = String(installerClientId || "").trim();
        const siteId = String(installerSiteId || "").trim();
        const name = keyName.trim();
        const expiresRaw = String(keyExpiresMinutes || "").trim();
        const expiresMinutes = Number.parseInt(expiresRaw, 10);

        if (!clientId || clientId === "__none") {
            setFlash({ kind: "error", text: "Select a client." });
            return;
        }
        if (!siteId || siteId === "__none") {
            setFlash({ kind: "error", text: "Select a site." });
            return;
        }
        if (!Number.isFinite(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 43200) {
            setFlash({ kind: "error", text: "Expiration must be between 1 and 43200 minutes." });
            return;
        }

        setCreatingKey(true);
        try {
            const res = await jfetch<CreateEnrollmentKeyResult>(`/api/provisioning/enrollment-keys`, {
                method: "POST",
                body: {
                    clientId,
                    siteId,
                    name: name || undefined,
                    expiresMinutes,
                },
            });

            setKeyResult(res);
            setFlash({
                kind: "success",
                text: `Reusable enrollment key created. Expires at ${new Date(res.expiresAt).toLocaleString()}.`,
            });
        } catch (e: any) {
            setKeyResult(null);
            setFlash({ kind: "error", text: e?.message || "Failed to create enrollment key." });
        } finally {
            setCreatingKey(false);
        }
    };

    const downloadInstaller = React.useCallback(
        async (os: InstallerOs) => {
            if (!keyResult?.enrollmentKey) return;

            setFlash(null);
            setDownloadingInstaller(os);

            try {
                // Option A: bundle request is keyed by reusable enrollmentKey (site-scoped, multi-use)
                const bundle = await getInstallerBundle({
                    os,
                    enrollmentKey: keyResult.enrollmentKey,
                } as any);

                startBrowserDownload(bundle.url);
                setFlash({ kind: "success", text: `Downloading ${os} installer...` });
            } catch (e: any) {
                setFlash({ kind: "error", text: e?.message || "Failed to download installer." });
            } finally {
                setDownloadingInstaller(null);
            }
        },
        [keyResult]
    );

    const enrollmentKeyPreview = React.useMemo(() => {
        if (!keyResult) return null;

        const payload = {
            enrollmentKey: keyResult.enrollmentKey,
            tokenId: keyResult.tokenId,
            clientId: keyResult.clientId,
            siteId: keyResult.siteId,
            expiresAt: keyResult.expiresAt,
            name: keyResult.name,
        };

        return JSON.stringify(payload, null, 2);
    }, [keyResult]);

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
                                    <DialogDescription>Adds a new client to the database.</DialogDescription>
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

                        {/* Reusable Installer (Option A) */}
                        <Dialog open={installerOpen} onOpenChange={setInstallerOpen}>
                            <DialogTrigger asChild>
                                <Button variant="secondary">Reusable Installer</Button>
                            </DialogTrigger>

                            <DialogContent className="sm:max-w-[720px]">
                                <DialogHeader>
                                    <DialogTitle>Reusable Installer</DialogTitle>
                                    <DialogDescription>
                                        Create a reusable (multi-use) enrollment key scoped to a site, then download an OS installer bundle that bakes it in.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-2">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label>Client</Label>
                                            <Select
                                                value={installerClientId}
                                                onValueChange={(v) => {
                                                    setInstallerClientId(v);
                                                    setInstallerSiteId("");
                                                    setKeyResult(null);
                                                }}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder={clientsLoading ? "Loading..." : "Select a client"} />
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
                                            <Label>Site</Label>
                                            <Select
                                                value={installerSiteId}
                                                onValueChange={(v) => {
                                                    setInstallerSiteId(v);
                                                    setKeyResult(null);
                                                }}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={
                                                            installerSitesLoading
                                                                ? "Loading..."
                                                                : installerClientId
                                                                    ? "Select a site"
                                                                    : "Select a client first"
                                                        }
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {installerSites.map((s) => (
                                                        <SelectItem key={s.key} value={s.key}>
                                                            {s.name}
                                                        </SelectItem>
                                                    ))}
                                                    {installerClientId && installerSites.length === 0 && (
                                                        <SelectItem value="__none" disabled>
                                                            No sites found
                                                        </SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label>Installer OS</Label>
                                            <Select value={installerOs} onValueChange={(v) => setInstallerOs(v as InstallerOs)}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="windows">Windows</SelectItem>
                                                    <SelectItem value="linux">Linux</SelectItem>
                                                    <SelectItem value="macos">macOS</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <div className="text-xs text-muted-foreground">
                                                You can download any OS bundle after generating the key.
                                            </div>
                                        </div>

                                        <div className="grid gap-2">
                                            <Label htmlFor="key-expires">Key expiration (minutes)</Label>
                                            <Input
                                                id="key-expires"
                                                inputMode="numeric"
                                                value={keyExpiresMinutes}
                                                onChange={(e) => setKeyExpiresMinutes(e.target.value)}
                                                placeholder="10080"
                                            />
                                            <div className="text-xs text-muted-foreground">
                                                1..43200 (up to 30 days). Default is 7 days.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid gap-2">
                                        <Label htmlFor="key-name">Key name (optional)</Label>
                                        <Input
                                            id="key-name"
                                            value={keyName}
                                            onChange={(e) => setKeyName(e.target.value)}
                                            placeholder="e.g., Huber Heights – Workstations"
                                        />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            type="button"
                                            onClick={submitCreateEnrollmentKey}
                                            disabled={creatingKey || !installerClientId || !installerSiteId}
                                        >
                                            {creatingKey ? "Creating..." : "Create Enrollment Key"}
                                        </Button>
                                        {keyResult?.enrollmentKey && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => copy(keyResult.enrollmentKey)}
                                            >
                                                Copy Key
                                            </Button>
                                        )}
                                    </div>

                                    {keyResult && enrollmentKeyPreview && (
                                        <div className="rounded-md border bg-muted/30 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm font-medium">Enrollment key (returned once)</div>
                                                <Button variant="outline" size="sm" onClick={() => copy(enrollmentKeyPreview)}>
                                                    Copy JSON
                                                </Button>
                                            </div>

                                            <div className="text-xs text-muted-foreground mt-1">
                                                Expires at{" "}
                                                <span className="font-medium">
                                                    {new Date(keyResult.expiresAt).toLocaleString()}
                                                </span>
                                                . TokenId:{" "}
                                                <span className="font-mono">{keyResult.tokenId}</span>
                                            </div>

                                            <pre className="mt-2 max-h-56 overflow-auto rounded bg-background p-3 text-xs">
                                                {enrollmentKeyPreview}
                                            </pre>

                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    onClick={() => downloadInstaller("windows")}
                                                    disabled={!keyResult?.enrollmentKey || !!downloadingInstaller}
                                                >
                                                    {downloadingInstaller === "windows" ? "Preparing..." : "Download Windows Installer"}
                                                </Button>

                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    onClick={() => downloadInstaller("linux")}
                                                    disabled={!keyResult?.enrollmentKey || !!downloadingInstaller}
                                                >
                                                    {downloadingInstaller === "linux" ? "Preparing..." : "Download Linux Installer"}
                                                </Button>

                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    onClick={() => downloadInstaller("macos")}
                                                    disabled={!keyResult?.enrollmentKey || !!downloadingInstaller}
                                                >
                                                    {downloadingInstaller === "macos" ? "Preparing..." : "Download macOS Installer"}
                                                </Button>

                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => downloadInstaller(installerOs)}
                                                    disabled={!keyResult?.enrollmentKey || !!downloadingInstaller}
                                                >
                                                    {downloadingInstaller === installerOs ? "Preparing..." : `Download Selected (${installerOs})`}
                                                </Button>
                                            </div>

                                            <div className="mt-3 text-xs text-muted-foreground">
                                                Keep the raw enrollment key safe. The backend only stores a hash and won’t show it again.
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <DialogFooter>
                                    <Button
                                        variant="outline"
                                        type="button"
                                        onClick={() => setInstallerOpen(false)}
                                        disabled={creatingKey || !!downloadingInstaller}
                                    >
                                        Close
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
                                    <DialogDescription>Adds a site under a specific client.</DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-2">
                                    <div className="grid gap-2">
                                        <Label>Client</Label>
                                        <Select value={siteClientId} onValueChange={setSiteClientId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder={clientsLoading ? "Loading..." : "Select a client"} />
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
                                        <Select value={deleteMode} onValueChange={(v) => setDeleteMode(v as "client" | "site")}>
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
                                                <SelectValue placeholder={clientsLoading ? "Loading..." : "Select a client"} />
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
                                            <Select value={deleteSiteId} onValueChange={setDeleteSiteId}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={sitesLoading ? "Loading..." : "Select a site"} />
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
                                            (deleteMode === "site" && (!deleteSiteId || deleteSiteId === "__none"))
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

        sorting,
        setSorting,
        columnVisibility,
        setColumnVisibility,
        columnFilters,
        setColumnFilters,

        registerSnapshotGetter,
        activeFilters,
    } = useDashboard();

    const { customersGroupOpen, expandedOrganizations, expandedSites } = useCustomers();

    React.useEffect(() => {
        const off = registerSnapshotGetter(() => ({
            columnVisibility,
            sorting,
            columnFilters,

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

            // Prefer UUID keys (clientId/siteId) but tolerate old name-based values in sets.
            const clientKey = getDeviceClientKey(d);
            const siteKey = getDeviceSiteKey(d);

            const orgSelected =
                expandedOrganizations.size > 0
                    ? expandedOrganizations.has(clientKey) ||
                    expandedOrganizations.has(String(d.client ?? ""))
                    : false;

            const siteSelected =
                expandedSites.size > 0
                    ? expandedSites.has(siteKey) || expandedSites.has(String(d.site ?? ""))
                    : false;

            // If sites selected, gate by org too (prevents cross-org collisions)
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
        return masterDevices.filter(
            (d) => matchesSidebarScope(d) && matchesOs(d) && matchesStatus(d)
        );
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
