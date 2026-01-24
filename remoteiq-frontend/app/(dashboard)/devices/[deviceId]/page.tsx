// app/(dashboard)/devices/[deviceId]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Power, Play, ShieldCheck, Tag, Move, Copy } from "lucide-react";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useDashboard, type Device as UiDevice } from "@/app/(dashboard)/dashboard-context";
import { StatusBadge } from "@/components/status-badge";
import SoftwareTab from "@/components/software-tab";
import ChecksAndAlertsTab from "@/components/checks-and-alerts-tab";
import PatchTab from "@/components/patch-tab";
import RemoteTab from "@/components/remote-tab";

import { useDevice } from "@/lib/use-device";

// US-style "MM/DD/YYYY - H:MM AM/PM"
const dtFmt = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
});

function formatLastSeenSafe(input?: unknown): string {
    if (input == null) return "—";

    const raw = String(input).trim();
    const low = raw.toLowerCase();

    // handle common “missing” string values
    if (!raw || low === "null" || low === "undefined" || low === "nan") return "—";

    const d = new Date(raw);
    const t = d.getTime();
    if (!Number.isFinite(t)) return "—";

    try {
        return dtFmt.format(d).replace(",", " -");
    } catch {
        return "—";
    }
}

type BadgeStatus = "healthy" | "warning" | "critical" | "offline";
function normalizeStatus(s?: string): BadgeStatus {
    switch ((s || "").toLowerCase()) {
        case "healthy":
            return "healthy";
        case "warning":
            return "warning";
        case "critical":
            return "critical";
        case "online":
            return "healthy";
        default:
            return "offline";
    }
}

export default function DeviceDetailPage({ params }: { params: { deviceId: string } }) {
    const { masterDevices, filteredDevices } = useDashboard();

    // ✅ Make "devices" stable so it doesn't trip react-hooks/exhaustive-deps
    const devices = React.useMemo(
        () => (masterDevices?.length ? masterDevices : filteredDevices) ?? [],
        [masterDevices, filteredDevices]
    );

    // Local (dashboard) device if present
    const localDevice: UiDevice | undefined = React.useMemo(
        () => devices.find((d) => d.id === params.deviceId),
        [devices, params.deviceId]
    );

    // Backend device (authoritative)
    const { device: apiDevice, loading, error, refresh } = useDevice(params.deviceId);

    // Merge API device into the UI shape your page expects.
    const device: UiDevice | undefined = React.useMemo(() => {
        if (!apiDevice && !localDevice) return undefined;

        const status = normalizeStatus(apiDevice?.status ?? (localDevice as any)?.status);
        const merged: Partial<UiDevice> = {
            id: apiDevice?.id ?? localDevice?.id ?? params.deviceId,
            hostname: apiDevice?.hostname ?? localDevice?.hostname ?? "",
            alias: localDevice?.alias ?? apiDevice?.hostname ?? "",
            client: (localDevice as any)?.client ?? "—",
            site: (localDevice as any)?.site ?? "—",
            os: apiDevice?.os ?? (localDevice as any)?.os ?? "Unknown",
            status,
            // carry lastSeen through as lastResponse for display
            lastResponse: apiDevice?.lastSeen ?? (localDevice as any)?.lastResponse ?? null,
            // extra fields from backend we’ll show directly below
            ...(apiDevice
                ? {
                    arch: apiDevice.arch,
                    primaryIp: apiDevice.primaryIp,
                    version: apiDevice.version,
                    user: apiDevice.user,
                    agentUuid:
                        (apiDevice as any)?.agentUuid ?? (localDevice as any)?.agentUuid ?? null,
                }
                : {
                    agentUuid: (localDevice as any)?.agentUuid ?? null,
                }),
        };

        return merged as unknown as UiDevice;
    }, [apiDevice, localDevice, params.deviceId]);

    const router = useRouter();
    const pathname = usePathname();
    const search = useSearchParams();

    const openRunScript = React.useCallback(() => {
        const current = new URLSearchParams(search?.toString() ?? "");
        current.set("device", params.deviceId);
        router.push(`${pathname}?${current.toString()}`);
    }, [params.deviceId, pathname, router, search]);

    const onReboot = React.useCallback(async () => {
        // TODO: wire your reboot call if available
    }, []);
    const onPatchNow = React.useCallback(async () => {
        // TODO: wire your patch call if available
    }, []);

    // ✅ HOOK DECLARED BEFORE ANY CONDITIONAL RETURNS
    const copy = React.useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            // optional: toast here
        } catch {
            // ignore
        }
    }, []);

    // ----- Conditional returns (no hooks below this line) -----
    if (loading && !device) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
                <div className="text-sm text-muted-foreground">Loading device…</div>
            </div>
        );
    }
    if (error && !device) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-6">
                <h2 className="text-2xl font-semibold">Error loading device</h2>
                <p className="text-muted-foreground">{String(error)}</p>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={refresh}>
                        Retry
                    </Button>
                    <Button asChild>
                        <Link href="/">Return to Dashboard</Link>
                    </Button>
                </div>
            </div>
        );
    }
    if (!device) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-6">
                <h2 className="text-2xl font-semibold">Device Not Found</h2>
                <p className="text-muted-foreground">
                    The device with ID &apos;{params.deviceId}&apos; could not be found.
                </p>
                <Button asChild>
                    <Link href="/">Return to Dashboard</Link>
                </Button>
            </div>
        );
    }

    const badgeStatus: BadgeStatus = normalizeStatus(device.status as unknown as string);

    const lastSeenIso = (device as any).lastResponse as string | null | undefined;
    const lastSeenStr = formatLastSeenSafe(lastSeenIso);

    const os = (device as any).os ?? "Unknown";
    const arch = (device as any).arch ?? "—";
    const primaryIp = (device as any).primaryIp ?? "—";
    const version = (device as any).version ?? "—";
    const currentUser = (device as any).user ?? "—";
    const agentUuid = (device as any)?.agentUuid as string | undefined | null;

    return (
        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
            <div className="mx-auto grid w-full flex-1 auto-rows-max gap-4">
                <div className="flex items-center justify-between gap-4">
                    <Breadcrumb className="hidden md:flex">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href="/">Dashboard</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href="/customers">Devices</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>
                                    {(device as any).alias || (device as any).hostname}
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="default"
                            size="sm"
                            onClick={openRunScript}
                            className="gap-2"
                            title="Open Run Script"
                        >
                            <Play className="h-4 w-4" /> Run Script
                        </Button>
                        <Button variant="outline" size="sm" title="Trigger a patch cycle" onClick={onPatchNow}>
                            <ShieldCheck className="h-4 w-4" /> Patch Now
                        </Button>
                        <Button variant="destructive" size="sm" title="Reboot this device" onClick={onReboot}>
                            <Power className="h-4 w-4" /> Reboot
                        </Button>
                    </div>
                </div>

                <Tabs defaultValue="overview">
                    <div className="flex items-center">
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="remote">Remote</TabsTrigger>
                            <TabsTrigger value="checks">Checks &amp; Alerts</TabsTrigger>
                            <TabsTrigger value="patch">Patch</TabsTrigger>
                            <TabsTrigger value="software">Software</TabsTrigger>
                        </TabsList>
                        <div className="ml-auto flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={refresh} title="Refresh device data">
                                Refresh
                            </Button>
                        </div>
                    </div>

                    <TabsContent value="overview">
                        <Card>
                            <CardHeader>
                                <div className="flex justify-between items-start gap-4">
                                    <div className="min-w-0">
                                        <CardTitle className="truncate">
                                            {(device as any).alias || (device as any).hostname}
                                        </CardTitle>
                                        <CardDescription className="truncate">
                                            {(device as any).client} / {(device as any).site}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button variant="outline" size="icon" title="Edit alias" aria-label="Edit alias">
                                            <Tag className="h-4 w-4" />
                                        </Button>
                                        <Button variant="outline" size="icon" title="Move device" aria-label="Move device">
                                            <Move className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Separator className="my-4" />
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">Status</h3>
                                        <StatusBadge status={badgeStatus} />
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">Operating System</h3>
                                        <p>{os}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">Architecture</h3>
                                        <p>{arch}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">IP Address</h3>
                                        <p>{primaryIp}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">Agent Version</h3>
                                        <p>{version}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium text-muted-foreground">Last Response</h3>
                                        <p>{lastSeenStr}</p>
                                    </div>

                                    {/* Agent UUID (optional) */}
                                    {agentUuid ? (
                                        <div className="space-y-1 md:col-span-3">
                                            <h3 className="font-medium text-muted-foreground">Agent UUID</h3>
                                            <div className="flex items-center gap-2">
                                                <code className="text-xs break-all">{agentUuid}</code>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    title="Copy agent UUID"
                                                    onClick={() => copy(agentUuid)}
                                                    className="gap-2"
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                    Copy
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="space-y-1 md:col-span-3">
                                        <h3 className="font-medium text-muted-foreground">Logged-in User</h3>
                                        <p>{currentUser}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="remote">
                        <RemoteTab />
                    </TabsContent>
                    <TabsContent value="checks">
                        <ChecksAndAlertsTab deviceId={params.deviceId} />
                    </TabsContent>
                    <TabsContent value="patch">
                        <PatchTab />
                    </TabsContent>
                    <TabsContent value="software">
                        <SoftwareTab />
                    </TabsContent>
                </Tabs>
            </div>
        </main>
    );
}
