// remoteiq-frontend/components/device-table-columns.tsx

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { formatUsDateTime } from "@/lib/time";
import {
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    MoreHorizontal,
    PlaySquare,
    ExternalLink,
    Copy,
    CircleDot,
    Edit3,
    Eraser,
    KeyRound,
    MoveRight,
    MapPin,
    CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

import { StatusBadge } from "@/components/status-badge";
import { Device, useDashboard } from "@/app/(dashboard)/dashboard-context";
import { toast } from "sonner";
import { fetchCustomers, fetchCustomerSites, moveDeviceToSite } from "@/lib/api";

/* ============================================================================
   Immediate UI updates without refresh:
   ========================================================================== */

type PlacementOverride = {
    client?: string | null;
    site?: string | null;
};

const placementOverrides = new Map<string, PlacementOverride>();
let placementVersion = 0;
const placementListeners = new Set<() => void>();

function emitPlacement() {
    placementVersion++;
    for (const l of placementListeners) l();
}

function setPlacementOverride(deviceId: string, patch: PlacementOverride) {
    const id = String(deviceId ?? "").trim();
    if (!id) return;

    const cur = placementOverrides.get(id) ?? {};
    const next = { ...cur, ...patch };
    placementOverrides.set(id, next);
    emitPlacement();
}

function clearPlacementOverride(deviceId: string) {
    const id = String(deviceId ?? "").trim();
    if (!id) return;

    if (placementOverrides.has(id)) {
        placementOverrides.delete(id);
        emitPlacement();
    }
}

function subscribePlacement(cb: () => void) {
    placementListeners.add(cb);
    return () => placementListeners.delete(cb);
}

function usePlacementOverride(deviceId: string) {
    React.useSyncExternalStore(
        subscribePlacement,
        () => placementVersion,
        () => 0
    );
    return placementOverrides.get(String(deviceId ?? "").trim()) ?? null;
}

function ClientCell({ device }: { device: Device }) {
    const ov = usePlacementOverride(device.id);
    const display = String(ov?.client ?? device.client ?? "");

    React.useEffect(() => {
        if (!ov) return;
        const clientMatches = (ov.client ?? null) === (device.client ?? null);
        const siteMatches = (ov.site ?? null) === (device.site ?? null);
        if (clientMatches && siteMatches) clearPlacementOverride(device.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [device.client, device.site, ov?.client, ov?.site, device.id]);

    return <span className="truncate">{display}</span>;
}

function SiteCell({ device }: { device: Device }) {
    const ov = usePlacementOverride(device.id);
    const display = String(ov?.site ?? device.site ?? "");

    React.useEffect(() => {
        if (!ov) return;
        const clientMatches = (ov.client ?? null) === (device.client ?? null);
        const siteMatches = (ov.site ?? null) === (device.site ?? null);
        if (clientMatches && siteMatches) clearPlacementOverride(device.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [device.client, device.site, ov?.client, ov?.site, device.id]);

    return <span className="truncate">{display}</span>;
}

/* ============================================================================
   Columns
   ========================================================================== */

function SortIndicator({ isSorted }: { isSorted: false | "asc" | "desc" }) {
    if (!isSorted) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-60" aria-hidden="true" />;
    if (isSorted === "asc") return <ArrowUp className="ml-2 h-4 w-4" aria-hidden="true" />;
    return <ArrowDown className="ml-2 h-4 w-4" aria-hidden="true" />;
}

function SortableHeader({ column, label }: { column: any; label: string }) {
    const isSorted = column.getIsSorted() as false | "asc" | "desc";
    const nextDir = isSorted === "asc" ? "descending" : "ascending";
    return (
        <Button
            variant="ghost"
            className="px-0 font-medium"
            onClick={() => column.toggleSorting(isSorted === "asc")}
            aria-label={`Sort by ${label} ${isSorted ? `(currently ${isSorted})` : ""}`}
            title={`Sort by ${label} ${isSorted ? `(currently ${isSorted}, click to ${nextDir})` : ""}`}
        >
            {label}
            <SortIndicator isSorted={isSorted} />
        </Button>
    );
}

export const columns: ColumnDef<Device>[] = [
    {
        accessorKey: "hostname",
        header: ({ column }) => <SortableHeader column={column} label="Hostname" />,
        cell: ({ row }) => {
            const d = row.original as Device;
            return (
                <Link href={`/devices/${d.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {d.alias ? (
                        <div className="leading-tight">
                            <div className="font-medium text-foreground">{d.alias}</div>
                            <div className="text-xs text-muted-foreground">{d.hostname}</div>
                        </div>
                    ) : (
                        <span className="font-medium text-foreground">{d.hostname}</span>
                    )}
                </Link>
            );
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader column={column} label="Status" />,
        cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
    },
    {
        accessorKey: "client",
        header: ({ column }) => <SortableHeader column={column} label="Client" />,
        cell: ({ row }) => <ClientCell device={row.original as Device} />,
    },
    {
        accessorKey: "site",
        header: ({ column }) => <SortableHeader column={column} label="Site" />,
        cell: ({ row }) => <SiteCell device={row.original as Device} />,
    },
    {
        accessorKey: "os",
        header: ({ column }) => <SortableHeader column={column} label="Operating System" />,
        cell: ({ row }) => <span>{row.getValue("os") as string}</span>,
    },
    {
        accessorKey: "user",
        header: ({ column }) => <SortableHeader column={column} label="User" />,
        cell: ({ row }) => {
            const u = row.getValue("user") as any;
            if (!u) return <span className="text-muted-foreground">—</span>;
            const text = Array.isArray(u) ? u.filter(Boolean).join(", ") : String(u);
            return <span className="truncate">{text || "—"}</span>;
        },
    },
    {
        accessorKey: "lastResponse",
        header: ({ column }) => <SortableHeader column={column} label="Last Response" />,
        cell: ({ row }) => {
            const iso = row.getValue("lastResponse") as string | null | undefined;
            const pretty = formatUsDateTime(iso);
            return iso ? (
                <time dateTime={iso} title={iso}>
                    {pretty}
                </time>
            ) : (
                <span className="text-muted-foreground">—</span>
            );
        },
    },
    {
        id: "actions",
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => <RowActions device={row.original} />,
    },
];

type ClientOption = {
    id: string;
    name: string;
};

type SiteOption = {
    id: string;
    clientId: string;
    name: string;
};

function normalizeName(s: unknown) {
    return String(s ?? "").trim().toLowerCase();
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function RowActions({ device }: { device: Device }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { updateDeviceAlias } = useDashboard();

    const [menuOpen, setMenuOpen] = React.useState(false);

    // Alias
    const [aliasOpen, setAliasOpen] = React.useState(false);
    const [aliasValue, setAliasValue] = React.useState(device.alias ?? "");
    const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);

    // Move-to-site dialog (same-client only)
    const [moveOpen, setMoveOpen] = React.useState(false);
    const [moveLoading, setMoveLoading] = React.useState(false);
    const [sitesLoading, setSitesLoading] = React.useState(false);

    const [moveClientId, setMoveClientId] = React.useState<string>("");
    const [moveClientName, setMoveClientName] = React.useState<string>("");

    const [siteQuery, setSiteQuery] = React.useState("");
    const [sites, setSites] = React.useState<SiteOption[]>([]);
    const [selectedSiteId, setSelectedSiteId] = React.useState<string>("");

    // Success confirmation (inside the modal)
    const [moveSuccess, setMoveSuccess] = React.useState<{
        clientName: string;
        siteName: string;
    } | null>(null);

    React.useEffect(() => {
        if (aliasOpen) setAliasValue(device.alias ?? "");
    }, [aliasOpen, device.alias]);

    const copy = async (text: string, label: string) => {
        try {
            setMenuOpen(false);
            await navigator.clipboard.writeText(text);
            toast.success(`${label} copied to clipboard`);
        } catch {
            toast.error("Copy failed: your browser blocked clipboard access");
        }
    };

    const saveAlias = () => {
        updateDeviceAlias(device.id, aliasValue || null);
        setAliasOpen(false);
        toast.success(aliasValue ? `Alias set to “${aliasValue}”` : "Alias cleared");
    };

    const openRunScriptHere = () => {
        setMenuOpen(false);
        const sp = new URLSearchParams(searchParams);
        sp.set("runScript", device.id);
        router.push(`${pathname}?${sp.toString()}`);
    };

    const confirmClearAlias = () => {
        updateDeviceAlias(device.id, null);
        setConfirmClearOpen(false);
        toast.success("Alias cleared");
    };

    const agentUuid = (device as any)?.agentUuid as string | undefined | null;

    const currentClientName = String(device.client ?? "").trim();
    const currentSiteName = String(device.site ?? "").trim();

    const openMoveDialog = async () => {
        setMenuOpen(false);
        setMoveOpen(true);

        // Reset each time
        setMoveClientId("");
        setMoveClientName(currentClientName);
        setSites([]);
        setSelectedSiteId("");
        setSiteQuery("");
        setMoveSuccess(null);

        if (!currentClientName) {
            toast.error("This device row has no client name, so we can’t determine allowed sites.");
            return;
        }

        try {
            setSitesLoading(true);

            const csRaw = await fetchCustomers();
            const clients: ClientOption[] = (csRaw ?? [])
                .map((c: any) => ({
                    id: String(c.id ?? c.key ?? ""),
                    name: String(c.name ?? c.label ?? ""),
                }))
                .filter((c) => c.id && c.name);

            const targetNorm = normalizeName(currentClientName);

            let match = clients.find((c) => normalizeName(c.name) === targetNorm);
            if (!match) {
                match = clients.find(
                    (c) =>
                        normalizeName(c.name).includes(targetNorm) ||
                        targetNorm.includes(normalizeName(c.name))
                );
            }

            if (!match?.id) {
                toast.error(`Could not find clientId for “${currentClientName}”. Make sure the client list contains this name.`);
                return;
            }

            setMoveClientId(match.id);
            setMoveClientName(match.name);

            const ss = await fetchCustomerSites(match.id);
            const normalized: SiteOption[] = (ss ?? [])
                .map((s: any) => ({
                    id: String(s.id ?? s.key ?? ""),
                    clientId: String(s.clientId ?? s.client_id ?? match!.id),
                    name: String(s.name ?? s.label ?? ""),
                }))
                .filter((x) => x.id && x.name);

            setSites(normalized);
        } catch (e: any) {
            toast.error(e?.message || "Failed to load sites");
            setSites([]);
        } finally {
            setSitesLoading(false);
        }
    };

    const filteredSites = React.useMemo(() => {
        const q = siteQuery.trim().toLowerCase();
        if (!q) return sites;
        return sites.filter((s) => s.name.toLowerCase().includes(q));
    }, [sites, siteQuery]);

    const selectedSiteName = React.useMemo(() => {
        return sites.find((s) => s.id === selectedSiteId)?.name ?? "";
    }, [sites, selectedSiteId]);

    const doMove = async () => {
        const siteId = String(selectedSiteId ?? "").trim();
        if (!siteId) {
            toast.error("Please select a target site");
            return;
        }

        try {
            setMoveLoading(true);

            await moveDeviceToSite(device.id, siteId);

            const finalClientName = moveClientName || currentClientName || "";
            const finalSiteName = selectedSiteName || "";

            // ✅ Immediate UI update in table
            setPlacementOverride(device.id, {
                client: finalClientName || null,
                site: finalSiteName || null,
            });

            // ✅ Visible confirmation
            toast.success("Device moved successfully");

            setMoveSuccess({
                clientName: finalClientName || "—",
                siteName: finalSiteName || "—",
            });

            // Give the user a moment to see the confirmation in the modal
            await sleep(700);

            setMoveOpen(false);
        } catch (e: any) {
            toast.error(e?.message || "Failed to move device");
        } finally {
            setMoveLoading(false);
        }
    };

    return (
        <>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Row actions for ${device.hostname}`}
                        title="Row actions"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel>{device.alias || device.hostname}</DropdownMenuLabel>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            setMenuOpen(false);
                            router.push(`/devices/${device.id}`);
                        }}
                    >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View details
                    </DropdownMenuItem>

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            openRunScriptHere();
                        }}
                    >
                        <PlaySquare className="mr-2 h-4 w-4" />
                        Run Script…
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            openMoveDialog();
                        }}
                    >
                        <MoveRight className="mr-2 h-4 w-4" />
                        Move to site…
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            setMenuOpen(false);
                            setAliasOpen(true);
                        }}
                    >
                        <Edit3 className="mr-2 h-4 w-4" />
                        Edit alias…
                    </DropdownMenuItem>

                    {device.alias ? (
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={(e) => {
                                e.preventDefault();
                                setMenuOpen(false);
                                setConfirmClearOpen(true);
                            }}
                        >
                            <Eraser className="mr-2 h-4 w-4" />
                            Clear alias
                        </DropdownMenuItem>
                    ) : null}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            copy(device.hostname, "Hostname");
                        }}
                    >
                        <Copy className="mr-2 h-4 w-4" />
                        Copy hostname
                    </DropdownMenuItem>

                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            copy(device.id, "Device ID");
                        }}
                    >
                        <CircleDot className="mr-2 h-4 w-4" />
                        Copy device ID
                    </DropdownMenuItem>

                    {agentUuid ? (
                        <DropdownMenuItem
                            onSelect={(e) => {
                                e.preventDefault();
                                copy(agentUuid, "Agent UUID");
                            }}
                        >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Copy agent UUID
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Move-to-site dialog */}
            <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
                <DialogContent onClick={(e) => e.stopPropagation()} className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Move device to a new site</DialogTitle>
                        <DialogDescription>
                            You can only move this device within its current client.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Success banner */}
                        {moveSuccess ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                                <div className="flex items-start gap-2">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden="true" />
                                    <div>
                                        <div className="font-medium">Move successful</div>
                                        <div className="text-xs opacity-90">
                                            Now in <span className="font-medium">{moveSuccess.clientName}</span> →{" "}
                                            <span className="font-medium">{moveSuccess.siteName}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-lg border p-3">
                            <div className="text-sm font-medium">{device.alias || device.hostname}</div>
                            <div className="text-xs text-muted-foreground">{device.hostname}</div>
                            <div className="mt-2 text-xs text-muted-foreground">
                                Current:{" "}
                                <span className="font-medium text-foreground">
                                    {moveClientName || currentClientName || "—"}
                                </span>{" "}
                                →{" "}
                                <span className="font-medium text-foreground">
                                    {currentSiteName || "—"}
                                </span>
                            </div>
                        </div>

                        {/* Site picker */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <div className="text-sm font-medium">Site</div>
                                {(moveClientName || currentClientName) ? (
                                    <span className="text-xs text-muted-foreground">
                                        for {moveClientName || currentClientName}
                                    </span>
                                ) : null}
                            </div>

                            <Input
                                placeholder={sitesLoading ? "Loading sites…" : "Search sites…"}
                                value={siteQuery}
                                onChange={(e) => setSiteQuery(e.target.value)}
                                disabled={sitesLoading || moveLoading || !moveClientName || !!moveSuccess}
                            />

                            <div className="max-h-52 overflow-auto rounded-md border">
                                {sitesLoading ? (
                                    <div className="p-3 text-sm text-muted-foreground">Loading sites…</div>
                                ) : filteredSites.length ? (
                                    filteredSites.map((s) => {
                                        const active = s.id === selectedSiteId;
                                        const isCurrent = normalizeName(s.name) === normalizeName(currentSiteName);

                                        return (
                                            <button
                                                key={s.id}
                                                type="button"
                                                className={[
                                                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                                                    "hover:bg-muted/60",
                                                    active ? "bg-muted" : "",
                                                    isCurrent ? "opacity-70" : "",
                                                ].join(" ")}
                                                onClick={() => setSelectedSiteId(s.id)}
                                                disabled={moveLoading || !!moveSuccess}
                                                title={isCurrent ? "Current site" : "Select site"}
                                            >
                                                <span className="truncate">{s.name}</span>
                                                {isCurrent ? (
                                                    <span className="text-xs text-muted-foreground">Current</span>
                                                ) : active ? (
                                                    <span className="text-xs text-muted-foreground">Selected</span>
                                                ) : null}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="p-3 text-sm text-muted-foreground">No sites found</div>
                                )}
                            </div>
                        </div>

                        {/* Summary */}
                        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Target</span>
                                <span className="font-medium">
                                    {(moveClientName || currentClientName) && selectedSiteName
                                        ? `${moveClientName || currentClientName} → ${selectedSiteName}`
                                        : (moveClientName || currentClientName)
                                            ? `${moveClientName || currentClientName} → (pick a site)`
                                            : "(pick a site)"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setMoveOpen(false)}
                            disabled={moveLoading}
                            title="Cancel"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={doMove}
                            disabled={!selectedSiteId || moveLoading || !!moveSuccess}
                            title="Move device"
                        >
                            {moveLoading ? "Moving…" : moveSuccess ? "Moved" : "Move"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Alias dialog */}
            <Dialog open={aliasOpen} onOpenChange={setAliasOpen}>
                <DialogContent onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle>Edit alias</DialogTitle>
                        <DialogDescription>Set a friendly name for this device.</DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Input
                            autoFocus
                            placeholder="e.g., Accounting File Server"
                            value={aliasValue}
                            onChange={(e) => setAliasValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") saveAlias();
                            }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAliasOpen(false)} title="Cancel">
                            Cancel
                        </Button>
                        <Button onClick={saveAlias} title="Save alias">
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Clear alias confirm */}
            <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Clear alias?</AlertDialogTitle>
                        <AlertDialogDescription>This will remove the alias for this device.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={confirmClearAlias}
                            title="Confirm clear alias"
                        >
                            Clear alias
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
