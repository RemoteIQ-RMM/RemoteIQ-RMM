//remoteiq-frontend\components\device-table-columns.tsx

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
    KeyRound, // <-- for UUID copy
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
                <Link
                    href={`/devices/${d.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    {d.alias ? (
                        <div className="leading-tight">
                            {/* changed from text-primary -> text-foreground for dark-mode readability */}
                            <div className="font-medium text-foreground">{d.alias}</div>
                            <div className="text-xs text-muted-foreground">{d.hostname}</div>
                        </div>
                    ) : (
                        // changed from text-primary -> text-foreground
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
        cell: ({ row }) => <span className="truncate">{row.getValue("client") as string}</span>,
    },
    {
        accessorKey: "site",
        header: ({ column }) => <SortableHeader column={column} label="Site" />,
        cell: ({ row }) => <span className="truncate">{row.getValue("site") as string}</span>,
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

function RowActions({ device }: { device: Device }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { updateDeviceAlias } = useDashboard();

    const [menuOpen, setMenuOpen] = React.useState(false);
    const [aliasOpen, setAliasOpen] = React.useState(false);
    const [aliasValue, setAliasValue] = React.useState(device.alias ?? "");
    const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);

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

                    {/* Only show if we actually have an agent UUID from the backend */}
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

            {/* Alias dialog */}
            <Dialog open={aliasOpen} onOpenChange={setAliasOpen}>
                <DialogContent onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle>Edit alias</DialogTitle>
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
                        <AlertDialogDescription>
                            This will remove the alias for this device.
                        </AlertDialogDescription>
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
