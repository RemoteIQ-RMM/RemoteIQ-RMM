// app/(dashboard)/devices/[deviceId]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Power, Play, Tag, Move, Copy, ArrowLeft, ExternalLink } from "lucide-react";

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
import FileBrowserTab from "@/components/file-browser-tab";
import { useDevice } from "@/lib/use-device";
import dynamic from "next/dynamic";

const RemoteShellPanel = dynamic(() => import("@/components/remote-shell-panel"), {
    ssr: false,
});

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

function formatBytes(bytes: unknown, decimals = 1): string {
    const n = typeof bytes === "string" ? Number(bytes) : typeof bytes === "number" ? bytes : NaN;
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n === 0) return "0 B";
    const k = 1024;
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    const v = n / Math.pow(k, i);
    const fixed = i === 0 ? 0 : decimals;
    return `${v.toFixed(fixed)} ${units[i]}`;
}

function clampPct(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, x));
}

function pickDiskBarClass(usedPct: number): string {
    if (usedPct >= 90) return "bg-red-500";
    if (usedPct >= 80) return "bg-yellow-500";
    return "bg-emerald-500";
}

type DiskFact = {
    mount?: string;
    name?: string;
    fs?: string;
    totalBytes?: number;
    freeBytes?: number;
    usedBytes?: number;
    usedPercent?: number;
    summary?: string;
};

function computeDisk(d: DiskFact) {
    const total = typeof d.totalBytes === "number" ? d.totalBytes : NaN;
    const free = typeof d.freeBytes === "number" ? d.freeBytes : NaN;
    const used =
        typeof d.usedBytes === "number"
            ? d.usedBytes
            : Number.isFinite(total) && Number.isFinite(free)
                ? total - free
                : NaN;

    const usedPct =
        typeof d.usedPercent === "number"
            ? d.usedPercent
            : Number.isFinite(total) && total > 0 && Number.isFinite(used)
                ? (used / total) * 100
                : NaN;

    const safeUsedPct = clampPct(Number.isFinite(usedPct) ? usedPct : 0);

    const builtSummary =
        d.summary ??
        (Number.isFinite(total) && Number.isFinite(free)
            ? `${formatBytes(free)} free of ${formatBytes(total)}`
            : "—");

    const title = String(d.mount ?? d.name ?? "Disk");
    const fs = d.fs ? String(d.fs) : "";

    return {
        title,
        fs,
        summary: builtSummary,
        usedPct: safeUsedPct,
        hasUsage: Number.isFinite(usedPct) || (Number.isFinite(total) && total > 0),
    };
}

function extractDeviceFactsRoot(facts: Record<string, any> | null): Record<string, any> | null {
    if (!facts || typeof facts !== "object") return null;

    const device = (facts as any).device;
    if (device && typeof device === "object") return device as Record<string, any>;

    const nestedFacts = (facts as any).facts;
    if (nestedFacts && typeof nestedFacts === "object") return nestedFacts as Record<string, any>;

    if ((facts as any).hardware || (facts as any).disks) return facts;

    return null;
}

type ActionBanner = { kind: "success" | "error" | "info"; text: string } | null;

async function safeJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

type ToolParam = "" | "remote-desktop" | "remote-shell" | "file-browser";
type TabValue = "overview" | "remote" | "checks" | "patch" | "software";

export default function DeviceDetailPage({ params }: { params: { deviceId: string } }) {
    const { masterDevices, filteredDevices } = useDashboard();

    const devices = React.useMemo(
        () => (masterDevices?.length ? masterDevices : filteredDevices) ?? [],
        [masterDevices, filteredDevices]
    );

    const localDevice: UiDevice | undefined = React.useMemo(
        () => devices.find((d) => d.id === params.deviceId),
        [devices, params.deviceId]
    );

    const { device: apiDevice, loading, error, refresh } = useDevice(params.deviceId);

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
            lastResponse: apiDevice?.lastSeen ?? (localDevice as any)?.lastResponse ?? null,
            ...(apiDevice
                ? {
                    arch: apiDevice.arch,
                    primaryIp: apiDevice.primaryIp,
                    version: apiDevice.version,
                    user: apiDevice.user,
                    agentUuid: (apiDevice as any)?.agentUuid ?? (localDevice as any)?.agentUuid ?? null,
                    facts: (apiDevice as any)?.facts ?? null,
                }
                : {
                    agentUuid: (localDevice as any)?.agentUuid ?? null,
                    facts: null,
                }),
        };

        return merged as unknown as UiDevice;
    }, [apiDevice, localDevice, params.deviceId]);

    const router = useRouter();
    const pathname = usePathname();
    const search = useSearchParams();

    const tool = (String(search?.get("tool") ?? "").trim() as ToolParam) || "";
    const popout = String(search?.get("popout") ?? "").trim() === "1";

    const [banner, setBanner] = React.useState<ActionBanner>(null);

    // ✅ Fix: tabs must have real state so clicks work
    const [tab, setTab] = React.useState<TabValue>("overview");

    const openRunScript = React.useCallback(() => {
        const current = new URLSearchParams(search?.toString() ?? "");
        current.set("device", params.deviceId);
        router.push(`${pathname}?${current.toString()}`);
    }, [params.deviceId, pathname, router, search]);

    const postDeviceAction = React.useCallback(
        async (action: "reboot") => {
            setBanner(null);

            const res = await fetch(`/api/devices/${encodeURIComponent(params.deviceId)}/actions/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ reason: "manual" }),
            });

            const body = await safeJson(res);

            if (res.status === 202 && body?.accepted && body?.jobId) {
                setBanner({
                    kind: "success",
                    text: `Reboot job queued successfully (Job ID: ${body.jobId}).`,
                });
                return;
            }

            if (res.status === 401 || res.status === 403) {
                setBanner({
                    kind: "error",
                    text: "You don’t have permission to run this action (401/403).",
                });
                return;
            }

            setBanner({
                kind: "error",
                text: `Action failed (${res.status}). ${body?.message ? String(body.message) : ""}`.trim(),
            });
        },
        [params.deviceId]
    );

    const onReboot = React.useCallback(async () => {
        await postDeviceAction("reboot");
    }, [postDeviceAction]);

    const copy = React.useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // ignore
        }
    }, []);

    const setTool = React.useCallback(
        (nextTool: ToolParam) => {
            const current = new URLSearchParams(search?.toString() ?? "");
            if (nextTool) current.set("tool", nextTool);
            else current.delete("tool");
            router.push(`${pathname}?${current.toString()}`);
        },
        [pathname, router, search]
    );

    const openPopout = React.useCallback(() => {
        const current = new URLSearchParams(search?.toString() ?? "");
        if (!current.get("tool")) current.set("tool", "file-browser");
        current.set("popout", "1");
        const url = `${pathname}?${current.toString()}`;
        window.open(url, "_blank", "noopener,noreferrer,width=1280,height=800");
    }, [pathname, search]);

    // ✅ If a tool is selected, force "remote" tab active.
    const tabsValue: TabValue = tool ? "remote" : tab;

    // ✅ Keep tab state sane if tool query param appears/disappears
    React.useEffect(() => {
        if (tool) {
            setTab("remote");
        }
    }, [tool]);

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

    const facts = ((device as any)?.facts ?? null) as Record<string, any> | null;
    const deviceFacts = extractDeviceFactsRoot(facts);

    const hwModel = deviceFacts?.hardware?.model ?? null;
    const hwCpu = deviceFacts?.hardware?.cpu ?? null;

    const hwRam =
        deviceFacts?.hardware?.ram ??
        (typeof deviceFacts?.hardware?.ramBytes === "number" ? formatBytes(deviceFacts.hardware.ramBytes) : null);

    const rawGpu = deviceFacts?.hardware?.gpu ?? null;
    const hwGpu = Array.isArray(rawGpu) ? rawGpu.filter(Boolean).join(", ") : rawGpu;

    const hwSerial = deviceFacts?.hardware?.serial ?? null;

    const disks = Array.isArray(deviceFacts?.disks) ? (deviceFacts?.disks as DiskFact[]) : null;

    const remoteTitle =
        tool === "file-browser" ? "File Browser" : tool === "remote-shell" ? "Remote Shell" : "Remote";

    // ✅ Popout mode: FULL WINDOW (no max width, no centered wrapper) + NO Back button
    // ✅ Popout fix: tool area gets the remaining viewport height like the main Remote tab
    if (popout) {
        return (
            <main className="min-h-screen w-full">
                <div className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">Device</div>
                            <div className="text-base font-semibold truncate">
                                {(device as any).alias || (device as any).hostname}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                                {(device as any).client} / {(device as any).site}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <Button variant="outline" onClick={() => window.close()} title="Close popout">
                                Close
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Give the tool the remaining viewport height (header is ~72px: py-3 + text) */}
                <div className="w-full p-4 h-[calc(100vh-72px)] min-h-0">
                    <div className="h-full min-h-0">
                        {tool === "file-browser" ? (
                            <FileBrowserTab deviceId={params.deviceId} popout />
                        ) : tool === "remote-shell" ? (
                            <RemoteShellPanel deviceId={params.deviceId} agentUuid={agentUuid ?? undefined} popout />
                        ) : (
                            <Card className="h-full">
                                <CardHeader>
                                    <CardTitle>Remote Tool</CardTitle>
                                    <CardDescription>
                                        Select a supported tool via <code className="text-xs">?tool=...</code>.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="text-sm text-muted-foreground">
                                    Unknown tool: <code className="text-xs">{tool || "(none)"}</code>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </main>
        );
    }

    const noAgent = !agentUuid;

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
                                <BreadcrumbPage>{(device as any).alias || (device as any).hostname}</BreadcrumbPage>
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

                        <Button variant="destructive" size="sm" title="Reboot this device" onClick={onReboot}>
                            <Power className="h-4 w-4" /> Reboot
                        </Button>
                    </div>
                </div>

                {banner ? (
                    <div
                        className={[
                            "rounded-md border px-3 py-2 text-sm",
                            banner.kind === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : banner.kind === "error"
                                    ? "border-red-200 bg-red-50 text-red-900"
                                    : "border-border bg-muted/40 text-foreground",
                        ].join(" ")}
                        role="status"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">{banner.text}</div>
                            <button
                                className="text-xs opacity-70 hover:opacity-100"
                                onClick={() => setBanner(null)}
                                aria-label="Dismiss message"
                                title="Dismiss"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                ) : null}

                <Tabs
                    value={tabsValue}
                    onValueChange={(v) => {
                        const next = (v as TabValue) || "overview";
                        setTab(next);

                        // leaving Remote? clear any selected tool so it stops forcing Remote
                        if (next !== "remote") setTool("");
                    }}
                >
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
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <Card className="lg:col-span-2">
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
                                    <div className="text-sm text-muted-foreground">
                                        <span className="font-medium text-foreground">{(device as any).hostname}</span>
                                        {" · "}
                                        <span>{os}</span>
                                        {" · "}
                                        <span>Agent v{version}</span>
                                    </div>

                                    <Separator className="my-4" />

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                                        <div className="space-y-2">
                                            <h3 className="font-medium">Hardware Details</h3>

                                            <div className="space-y-1 text-muted-foreground">
                                                <div className="flex justify-between gap-4">
                                                    <span>Status</span>
                                                    <span className="text-foreground">
                                                        <StatusBadge status={badgeStatus} />
                                                    </span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>Architecture</span>
                                                    <span className="text-foreground">{arch}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>Logged-in User</span>
                                                    <span className="text-foreground">{currentUser}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>LAN IP</span>
                                                    <span className="text-foreground">{primaryIp}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>Last Response</span>
                                                    <span className="text-foreground">{lastSeenStr}</span>
                                                </div>

                                                <Separator className="my-3" />

                                                <div className="flex justify-between gap-4">
                                                    <span>System Model</span>
                                                    <span className="text-foreground">{hwModel ? String(hwModel) : "—"}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>CPU</span>
                                                    <span className="text-foreground">{hwCpu ? String(hwCpu) : "—"}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>RAM</span>
                                                    <span className="text-foreground">{hwRam ? String(hwRam) : "—"}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>GPU</span>
                                                    <span className="text-foreground">{hwGpu ? String(hwGpu) : "—"}</span>
                                                </div>

                                                <div className="flex justify-between gap-4">
                                                    <span>System Serial Number</span>
                                                    <span className="text-foreground">{hwSerial ? String(hwSerial) : "—"}</span>
                                                </div>

                                                {!deviceFacts ? (
                                                    <div className="pt-2 text-xs text-muted-foreground">
                                                        Awaiting agent hardware/disk facts (ensure the agent is sending them and the backend is storing them).
                                                    </div>
                                                ) : null}
                                            </div>

                                            {agentUuid ? (
                                                <div className="pt-3 space-y-1">
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

                                            {noAgent ? (
                                                <div className="pt-2 text-xs text-muted-foreground">
                                                    This device has no <span className="font-medium">agentUuid</span> yet, so Remote Shell can’t connect.
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="space-y-2">
                                            <h3 className="font-medium">Checks Status</h3>
                                            <div className="text-sm text-muted-foreground">No checks</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Disks</CardTitle>
                                </CardHeader>
                                <CardContent className="text-sm">
                                    {!disks?.length ? (
                                        <div className="text-muted-foreground">—</div>
                                    ) : (
                                        <div className="space-y-4">
                                            {disks.map((raw, idx) => {
                                                const d = computeDisk(raw);
                                                const barClass = pickDiskBarClass(d.usedPct);

                                                return (
                                                    <div key={idx} className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <div className="font-medium">
                                                                {d.title}
                                                                {d.fs ? (
                                                                    <span className="text-muted-foreground font-normal"> ({d.fs})</span>
                                                                ) : null}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {d.hasUsage ? `${d.usedPct.toFixed(0)}% used` : ""}
                                                            </div>
                                                        </div>

                                                        <div
                                                            className="h-2 w-full rounded-full bg-muted overflow-hidden"
                                                            role="progressbar"
                                                            aria-valuenow={d.usedPct}
                                                            aria-valuemin={0}
                                                            aria-valuemax={100}
                                                            aria-label={`${d.title} disk usage`}
                                                        >
                                                            <div className={`h-full ${barClass}`} style={{ width: `${d.usedPct}%` }} />
                                                        </div>

                                                        <div className="text-xs text-muted-foreground">{d.summary}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="remote" className="h-[calc(100vh-220px)] min-h-0">
                        {tool === "file-browser" || tool === "remote-shell" ? (
                            <div className="flex h-full flex-col gap-3 min-h-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm text-muted-foreground">Remote</div>
                                        <div className="text-lg font-semibold truncate">{remoteTitle}</div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button variant="outline" onClick={() => setTool("")} className="gap-2">
                                            <ArrowLeft className="h-4 w-4" />
                                            Back
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={openPopout}
                                            className="gap-2"
                                            title="Open in a new window"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            Pop out
                                        </Button>
                                    </div>
                                </div>

                                {/* this is the key: give the tool area the remaining height */}
                                <div className="flex-1 min-h-0">
                                    {tool === "file-browser" ? (
                                        <FileBrowserTab deviceId={params.deviceId} />
                                    ) : (
                                        <RemoteShellPanel deviceId={params.deviceId} agentUuid={agentUuid ?? undefined} />
                                    )}
                                </div>
                            </div>
                        ) : (
                            <RemoteTab deviceId={params.deviceId} />
                        )}
                    </TabsContent>

                    <TabsContent value="checks">
                        <ChecksAndAlertsTab deviceId={params.deviceId} />
                    </TabsContent>
                    <TabsContent value="patch">
                        <PatchTab deviceId={params.deviceId} />
                    </TabsContent>
                    <TabsContent value="software">
                        <SoftwareTab />
                    </TabsContent>
                </Tabs>
            </div>
        </main>
    );
}
