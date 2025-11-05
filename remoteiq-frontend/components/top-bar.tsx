// app/(dashboard)/top-bar.tsx
"use client";

/**
 * Top Bar
 * ----------------------------------------------------------------
 * Saved Views + Automation + Search + Theme + Admin + Avatar
 * Adds "Dashboard" and "Customers" tabs next to the brand.
 * Uses user avatar from /api/users/me when available.
 */

import React, { useEffect, useRef, useState } from "react";
import {
    Moon,
    Search,
    Sun,
    Bell,
    Bookmark,
    PlusCircle,
    Trash2,
    Laptop,
    PlaySquare,
    ChevronDown,
    Link as LinkIcon,
    Save,
    ActivitySquare,
    MemoryStick,
    Shield,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
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
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import RunScriptModal from "@/components/run-script-modal";
import { useDashboard, SavedView } from "@/app/(dashboard)/dashboard-context";
import { useBranding } from "@/app/providers/BrandingProvider";

const TOP_BAR_HEIGHT = 56;
const PLACEHOLDER_AVATAR = "/avatar-placeholder.png"; // ensure this exists in FE /public

type ToastKind = "success" | "destructive" | "default";
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: string; title: string; desc?: string; kind: ToastKind; action?: ToastAction };

function useToasts() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const push = (toast: Omit<Toast, "id">) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((t) => [...t, { ...toast, id }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    };
    return { toasts, push };
}

function useMiniRmmStats() {
    const [cpu, setCpu] = useState(18);
    const [ram, setRam] = useState(42);
    useEffect(() => {
        const id = window.setInterval(() => {
            setCpu((c) => Math.max(1, Math.min(99, Math.round(c + (Math.random() * 6 - 3)))));
            setRam((m) => Math.max(1, Math.min(99, Math.round(m + (Math.random() * 6 - 3)))));
        }, 4000);
        return () => clearInterval(id);
    }, []);
    return { cpu, ram };
}

/** Brand logo that respects saved branding (light/dark) */
function AppLogo() {
    const { branding } = useBranding();
    const light = branding?.logoLightUrl ?? undefined;
    const dark = branding?.logoDarkUrl ?? undefined;
    return (
        <div className="flex items-center gap-2">
            <picture>
                {dark ? <source srcSet={dark} media="(prefers-color-scheme: dark)" /> : null}
                <img
                    src={light || dark || "/logo.png"}
                    alt="RemoteIQ"
                    width={28}
                    height={28}
                    className="rounded-sm"
                />
            </picture>
            <span className="font-semibold">RemoteIQ</span>
        </div>
    );
}

function getInitials(name?: string, email?: string) {
    const fromName =
        (name || "")
            .split(" ")
            .map((s) => s.trim()[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase();
    if (fromName) return fromName;
    const fromEmail = (email || "").trim()[0];
    return (fromEmail || "U").toUpperCase();
}

function normalizeAvatarUrl(raw?: string): string | undefined {
    if (!raw) return undefined;
    const url = raw.trim();
    if (!url) return undefined;
    // Absolute: http(s)://... or data:
    if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return url;
    // Relative to API base
    const base = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!base) return url; // hope same-origin
    if (url.startsWith("/")) return `${base}${url}`;
    return `${base}/${url}`;
}

type MeProfileResponse = {
    id: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    avatar_url?: string;
};

export default function TopBar() {
    const pathname = usePathname();
    const isDashboard = pathname === "/" || pathname === "/(dashboard)";
    const isCustomers = pathname.startsWith("/customers");
    const isTickets = pathname.startsWith("/tickets");
    // TODO: wire to real auth/role state
    const isSuperAdmin = true;

    const { setTheme } = useTheme();
    const {
        savedViews,
        saveCurrentView,
        loadView,
        deleteView,
        overwriteViewFromCurrent,
        getEncodedCurrentView,
    } = useDashboard();

    const router = useRouter();
    const searchParams = useSearchParams();

    const [newViewName, setNewViewName] = useState("");
    const [isSaveDialogOpen, setSaveDialogOpen] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const [viewToDelete, setViewToDelete] = useState<SavedView | null>(null);
    const [viewToOverwrite, setViewToOverwrite] = useState<SavedView | null>(null);

    const [isRunScriptOpen, setRunScriptOpen] = useState(false);
    const [preselectIds, setPreselectIds] = useState<string[] | undefined>(undefined);
    const [automationOpen, setAutomationOpen] = useState(false);

    const { toasts, push } = useToasts();

    // ---------- CURRENT USER (avatar + initials) ----------
    const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
    const [avatarErrored, setAvatarErrored] = useState(false);
    const [initials, setInitials] = useState("U");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Pull full profile which contains avatarUrl
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/users/me`, {
                    credentials: "include",
                });
                if (!res.ok) throw new Error(`Profile fetch failed (${res.status})`);
                const data: MeProfileResponse = await res.json();
                if (cancelled) return;

                const raw = (data as any)?.avatarUrl || (data as any)?.avatar_url || "";
                const normalized = normalizeAvatarUrl(raw);
                setAvatarUrl(normalized);
                setInitials(getInitials(data?.name, data?.email));
            } catch {
                // keep initials-only fallback
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const setQuery = (key: string, value?: string) => {
        const url = new URL(window.location.href);
        if (!value) url.searchParams.delete(key);
        else url.searchParams.set(key, value);
        router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    };

    // modal open-from-URL guard
    const lastOpenedIdRef = useRef<string | null>(null);
    const openedFromUrlRef = useRef<boolean>(false);
    useEffect(() => {
        const runScriptId = searchParams.get("runScript");
        const deviceId = searchParams.get("device");
        const theId = runScriptId || deviceId;
        if (!theId || isRunScriptOpen || lastOpenedIdRef.current === theId) return;

        lastOpenedIdRef.current = theId;
        openedFromUrlRef.current = true;
        setPreselectIds([theId]);
        setRunScriptOpen(true);
        setAutomationOpen(false);
    }, [searchParams, isRunScriptOpen]);

    const handleRunScriptOpenChange = (open: boolean) => {
        setRunScriptOpen(open);
        if (!open) {
            setPreselectIds(undefined);
            if (openedFromUrlRef.current) {
                openedFromUrlRef.current = false;
                router.back();
            } else {
                setQuery("runScript");
                setQuery("device");
            }
            window.setTimeout(() => {
                lastOpenedIdRef.current = null;
            }, 0);
        }
    };

    // Saved views actions
    const handleSaveView = () => {
        const trimmed = newViewName.trim();
        if (!trimmed) return setNameError("Please enter a name.");
        if (savedViews.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) {
            return setNameError("A view with this name already exists.");
        }
        saveCurrentView(trimmed);
        push({ title: "Saved view created", desc: `"${trimmed}" was saved.`, kind: "success" });
        setNewViewName("");
        setNameError(null);
        setSaveDialogOpen(false);
    };
    const confirmDelete = () => {
        if (!viewToDelete) return;
        deleteView(viewToDelete.id);
        push({ title: "Saved view deleted", desc: `"${viewToDelete.name}" was removed.`, kind: "destructive" });
        setViewToDelete(null);
    };
    const confirmOverwrite = () => {
        if (!viewToOverwrite) return;
        overwriteViewFromCurrent(viewToOverwrite.id);
        push({ title: "Saved view updated", desc: `"${viewToOverwrite.name}" was overwritten.`, kind: "success" });
        setViewToOverwrite(null);
    };

    const handleCopyViewLink = async () => {
        try {
            const encoded = getEncodedCurrentView({ includeLayouts: true });
            const url = new URL(window.location.href);
            if (encoded) url.searchParams.set("v", encoded);
            else url.searchParams.delete("v");
            const href = url.toString();
            await navigator.clipboard.writeText(href);
            push({
                title: "Link copied",
                desc: "The current view URL is in your clipboard.",
                kind: "success",
                action: { label: "Open", onClick: () => window.open(href, "_blank", "noopener,noreferrer") },
            });
        } catch {
            push({ title: "Copy failed", desc: "Could not write to clipboard.", kind: "destructive" });
        }
    };

    const { cpu, ram } = useMiniRmmStats();

    const handleLogout = async () => {
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/auth/logout`, {
                method: "POST",
                credentials: "include",
            });
        } catch { }
        router.replace("/login?next=/");
    };

    return (
        <>
            <header
                className="fixed inset-x-0 top-0 z-50 flex h-14 items-center border-b bg-background"
                style={{ height: TOP_BAR_HEIGHT }}
            >
                {/* Left cluster: brand + tabs + automation */}
                <div className="flex items-center gap-2 px-2 sm:px-3">
                    <Link href="/" className="flex items-center gap-2">
                        <AppLogo />
                    </Link>

                    <div className="ml-1 hidden sm:flex items-center">
                        <div className="flex items-center">
                            <Button
                                asChild
                                variant={isDashboard ? "secondary" : "ghost"}
                                size="sm"
                                title="Dashboard"
                                className="rounded-none first:rounded-l-md px-4"
                            >
                                <Link href="/">Dashboard</Link>
                            </Button>
                            <div className="h-6 w-px bg-border self-center" />
                            <Button
                                asChild
                                variant={isCustomers ? "secondary" : "ghost"}
                                size="sm"
                                title="Customers"
                                className="rounded-none last:rounded-r-md px-4"
                            >
                                <Link href="/customers">Customers</Link>
                            </Button>
                            <div className="h-6 w-px bg-border self-center" />
                            <Button
                                asChild
                                variant={isTickets ? "secondary" : "ghost"}
                                size="sm"
                                title="Tickets"
                                className="rounded-none last:rounded-r-md px-4"
                            >
                                <Link href="/tickets">Tickets</Link>
                            </Button>
                        </div>
                    </div>

                    <DropdownMenu open={automationOpen} onOpenChange={setAutomationOpen}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-2" title="Open automation tools">
                                Automation
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem
                                onSelect={(e) => {
                                    e.preventDefault();
                                    setAutomationOpen(false);
                                    setPreselectIds(undefined);
                                    setRunScriptOpen(true);
                                    const url = new URL(window.location.href);
                                    url.searchParams.delete("runScript");
                                    url.searchParams.delete("device");
                                    history.replaceState(null, "", url.toString());
                                    openedFromUrlRef.current = false;
                                    lastOpenedIdRef.current = null;
                                }}
                            >
                                <PlaySquare className="mr-2 h-4 w-4" />
                                Run Script
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled>More tools coming…</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex-1" />

                {/* Right cluster — avatar MUST be last */}
                <div className="flex items-center gap-2 pr-2 sm:pr-3">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleCopyViewLink}
                        title="Copy link to current view"
                    >
                        <LinkIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">Copy View Link</span>
                    </Button>

                    <Dialog open={isSaveDialogOpen} onOpenChange={setSaveDialogOpen}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" title="Manage saved views">
                                    <Bookmark className="h-4 w-4 mr-2" />
                                    Saved Views
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                                <DialogTrigger asChild>
                                    <DropdownMenuItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            setSaveDialogOpen(true);
                                        }}
                                    >
                                        <PlusCircle className="mr-2 h-4 w-4" />
                                        <span>Save Current View</span>
                                    </DropdownMenuItem>
                                </DialogTrigger>
                                <DropdownMenuSeparator />
                                {savedViews.length === 0 && (
                                    <DropdownMenuItem disabled>No saved views</DropdownMenuItem>
                                )}
                                {savedViews.map((view) => (
                                    <DropdownMenuItem
                                        key={view.id}
                                        onSelect={() => {
                                            const ok = loadView(view.id);
                                            if (ok)
                                                push({
                                                    title: "Saved view loaded",
                                                    desc: `"${view.name}" applied.`,
                                                    kind: "success",
                                                });
                                        }}
                                        className="flex items-center gap-2 py-2"
                                    >
                                        <span className="flex-1 truncate">{view.name}</span>
                                        <Button
                                            variant="warning"
                                            size="icon"
                                            className="h-6 w-6"
                                            title="Overwrite from current"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setViewToOverwrite(view);
                                            }}
                                        >
                                            <Save className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setViewToDelete(view);
                                            }}
                                            aria-label={`Delete ${view.name}`}
                                            title="Delete"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Save dialog */}
                        <DialogContent>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSaveView();
                                }}
                            >
                                <DialogHeader>
                                    <DialogTitle>Save New View</DialogTitle>
                                    <DialogDescription>
                                        Saves column visibility, scope, and any active filters/sorting.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="sv-name" className="text-right">
                                            Name
                                        </Label>
                                        <div className="col-span-3">
                                            <Input
                                                id="sv-name"
                                                value={newViewName}
                                                onChange={(e) => {
                                                    setNewViewName(e.target.value);
                                                    setNameError(null);
                                                }}
                                                placeholder="e.g., Global Windows Servers"
                                                autoFocus
                                            />
                                            {nameError && (
                                                <p className="mt-1 text-xs text-destructive">{nameError}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setSaveDialogOpen(false)}
                                        title="Cancel"
                                    >
                                        Cancel
                                    </Button>
                                    <Button type="submit" variant="success" title="Save view">
                                        Save
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>

                    {/* Search */}
                    <div className="relative hidden md:block">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search devices, sites, customers…"
                            className="w-[320px] rounded-lg bg-background pl-8"
                        />
                    </div>

                    {/* Mini CPU/RAM */}
                    <div className="hidden sm:flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-2 cursor-default" title="RMM Server CPU">
                            <ActivitySquare className="h-4 w-4" />
                            <span className="tabular-nums">{cpu}%</span>
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2 cursor-default" title="RMM Server RAM">
                            <MemoryStick className="h-4 w-4" />
                            <span className="tabular-nums">{ram}%</span>
                        </Button>
                    </div>

                    {/* Theme */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" title="Theme">
                                <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                                <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                                <span className="sr-only">Toggle theme</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setTheme("light")}>
                                <Sun className="mr-2 h-4 w-4" />
                                Light
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("dark")}>
                                <Moon className="mr-2 h-4 w-4" />
                                Dark
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("system")}>
                                <Laptop className="mr-2 h-4 w-4" />
                                System
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Notifications */}
                    <Button variant="outline" size="icon" aria-label="Notifications" title="Notifications">
                        <Bell className="h-5 w-5" />
                    </Button>

                    {/* Admin (shield) — only for super admins */}
                    {isSuperAdmin && (
                        <Button asChild variant="outline" size="icon" title="Administration" aria-label="Administration">
                            <Link href="/administration">
                                <Shield className="h-5 w-5" />
                            </Link>
                        </Button>
                    )}

                    {/* Avatar menu — ALWAYS LAST */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                title="Account"
                                aria-label="Account"
                                className="rounded-full overflow-hidden"
                            >
                                <Avatar className="h-8 w-8">
                                    <AvatarImage
                                        src={avatarErrored ? PLACEHOLDER_AVATAR : (avatarUrl || PLACEHOLDER_AVATAR)}
                                        alt="User"
                                        onError={() => setAvatarErrored(true)}
                                        referrerPolicy="no-referrer"
                                    />
                                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem asChild>
                                <Link href="/account">Account</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push("/account#security")}>
                                Security
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout}>Sign out</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>

            {/* Overwrite confirm */}
            <AlertDialog open={!!viewToOverwrite} onOpenChange={(o) => !o && setViewToOverwrite(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Overwrite saved view?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Replace settings of <b>{viewToOverwrite?.name}</b> with your current configuration.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-amber-500 text-white hover:bg-amber-500/90 dark:bg-amber-600 dark:hover:bg-amber-600/90"
                            onClick={() => {
                                // will be set by confirmOverwrite outside
                            }}
                        >
                            Overwrite
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete confirm */}
            <AlertDialog open={!!viewToDelete} onOpenChange={(o) => !o && setViewToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete saved view?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <b>{viewToDelete?.name}</b>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                // will be set by confirmDelete outside
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Run Script modal */}
            <RunScriptModal
                open={isRunScriptOpen}
                onOpenChange={setRunScriptOpen}
                preselectDeviceIds={preselectIds}
            />

            {/* Toasts */}
            <div className="fixed bottom-4 right-4 z-[100] space-y-2">
                {toasts.map((t) => {
                    const klass =
                        t.kind === "success"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200"
                            : t.kind === "destructive"
                                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200"
                                : "border-border bg-card text-card-foreground";
                    return (
                        <div key={t.id} className={`rounded-md border px-4 py-3 shadow-md w-[340px] ${klass}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-medium">{t.title}</div>
                                    {t.desc && <div className="mt-1 text-xs/5 opacity-90">{t.desc}</div>}
                                </div>
                                {t.action && (
                                    <button
                                        className="text-xs underline underline-offset-2 hover:opacity-80"
                                        onClick={t.action.onClick}
                                        title={t.action.label}
                                    >
                                        {t.action.label}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
