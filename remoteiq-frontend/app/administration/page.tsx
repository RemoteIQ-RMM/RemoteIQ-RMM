// app/administration/page.tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Shield,
    ShieldCheck,
    Users,
    KeyRound,
    ServerCog,
    FileText,
    Rocket,
    Mail,
    Database,
    Cloud,
    ArchiveRestore,
    FileSignature,
    Building2,
    CreditCard,
    ReceiptText,
    Palette,
    Languages,
    BellRing,
    LockKeyhole,
    Gavel,
    Plug,
    Laptop2,
    Workflow,
    ArrowRightLeft,
    ListPlus,
    Gem,
    UserCog,
    Ticket,
    Vault,
    Table,
    DatabaseZap,
    BarChart3,
    BookUser,
    CalendarClock,
    Lock,
    UserCheck,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// API
import {
    getAdminUsers,
    getAdminRoles,
    removeUser,
    getLocalizationSettings,
    type UserDTO,
} from "@/lib/api";

// Shared UI types
import type { User as UiUser, LocalizationSettings } from "./types";

// Tabs (lazy)
const UsersTab = dynamic(() => import("./tabs/UsersTab"));
const RolesTab = dynamic(() => import("./tabs/RolesTab"));
const CompanyTab = dynamic(() => import("./tabs/CompanyTab"));
const BillingTab = dynamic(() => import("./tabs/BillingTab"));
const InvoicesTab = dynamic(() => import("./tabs/InvoicesTab"));
const SmtpTab = dynamic(() => import("./tabs/SmtpTab"));
const SystemTab = dynamic(() => import("./tabs/SystemTab"));
const SsoTab = dynamic(() => import("./tabs/SsoTab"));
const DatabaseTab = dynamic(() => import("./tabs/DatabaseTab"));
const StorageTab = dynamic(() => import("./tabs/StorageTab"));
const BackupsTab = dynamic(() => import("./tabs/BackupsTab"));
const EmailTemplatesTab = dynamic(() => import("./tabs/TemplatesTab"));
const AuditLogsTab = dynamic(() => import("./tabs/AuditLogsTab"));
const ApiTab = dynamic(() => import("./tabs/ApiTab"));
const FeatureFlagsTab = dynamic(() => import("./tabs/FlagsTab"));
const BrandingTab = dynamic(() => import("./tabs/BrandingTab"));
const LocalizationTab = dynamic(() => import("./tabs/LocalizationTab"));
const NotificationsTab = dynamic(() => import("./tabs/NotificationsTab"));
const SecurityPoliciesTab = dynamic(() => import("./tabs/SecurityPoliciesTab"));
const IntegrationsTab = dynamic(() => import("./tabs/IntegrationsTab"));
const SubscriptionTab = dynamic(() => import("./tabs/SubscriptionTab"));
const ClientPortalTab = dynamic(() => import("./tabs/ClientPortalTab"));
const ComplianceTab = dynamic(() => import("./tabs/ComplianceTab"));
const AgentsTab = dynamic(() => import("./tabs/AgentsTab"));
const WorkflowsTab = dynamic(() => import("./tabs/WorkflowsTab"));
const ImportExportTab = dynamic(() => import("./tabs/ImportExportTab"));
const CustomFieldsTab = dynamic(() => import("./tabs/CustomFieldsTab"));
const SlaTab = dynamic(() => import("./tabs/SlaTab"));
const TicketingTab = dynamic(() => import("./tabs/TicketingTab"));
const SecretsTab = dynamic(() => import("./tabs/SecretsTab"));
// ✅ Use the SessionsTab from account (has onDirtyChange/saveHandleRef)
const SessionsTab = dynamic(() => import("../account/tabs/SessionsTab"));
const RolesMatrixTab = dynamic(() => import("./tabs/RolesMatrixTab"));
const MigrationsTab = dynamic(() => import("./tabs/MigrationsTab"));
const SupportTab = dynamic(() => import("./tabs/SupportTab"));
const ReportsTab = dynamic(() => import("./tabs/ReportsTab"));

/* ---------------- Toasts ---------------- */
type Toast = {
    id: string;
    title: string;
    desc?: string;
    kind: "success" | "destructive" | "warning" | "default";
};

function useToasts() {
    const [toasts, setToasts] = React.useState<Toast[]>([]);
    const push = React.useCallback((t: Omit<Toast, "id">) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((prev) => [...prev, { ...t, id }]);
        window.setTimeout(
            () => setToasts((prev) => prev.filter((x) => x.id !== id)),
            4200
        );
    }, []);
    return { toasts, push };
}

/* ---------------- Helpers ---------------- */
function mapUserDTO(u: UserDTO): UiUser {
    // keep API fields intact; UsersTab expects UiUser shape
    return { ...(u as any) } as unknown as UiUser;
}

// API base helper (so we can call /api/roles directly)
function getApiBase(): string {
    const raw = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!raw) return "/api";
    return raw.endsWith("/api") ? raw : `${raw}/api`;
}
const API_BASE = getApiBase();

// Coerce API firstDayOfWeek into the UI union: "sunday" | "monday"
function coerceFirstDay(apiVal: unknown): "sunday" | "monday" {
    if (typeof apiVal === "string") {
        const v = apiVal.toLowerCase();
        if (v === "sunday" || v === "monday") return v;
    }
    if (typeof apiVal === "number") {
        return apiVal === 0 ? "sunday" : "monday";
    }
    return "monday";
}

function mapLocalization(apiLoc: any): LocalizationSettings {
    const allowedLangs = new Set(["en-US", "en-GB", "es-ES", "fr-FR"]);
    const langRaw = apiLoc?.language;
    const language = allowedLangs.has(langRaw) ? langRaw : "en-US";

    return {
        language,
        timeZone: apiLoc?.timeZone ?? apiLoc?.timezone ?? "UTC",
        numberFormat: apiLoc?.numberFormat ?? "1,234.56",
        dateFormat: apiLoc?.dateFormat ?? "YYYY-MM-DD",
        timeFormat: apiLoc?.timeFormat ?? "24h",
        firstDayOfWeek: coerceFirstDay(apiLoc?.firstDayOfWeek),
    };
}

export default function AdministrationPage() {
    const { toasts, push: pushToast } = useToasts();
    const push = pushToast;

    // -------- tab state with URL + localStorage persistence --------
    const router = useRouter();
    const searchParams = useSearchParams();
    const [tab, setTab] = React.useState("company");

    // ===== SHARED DATA =====
    const [users, setUsers] = React.useState<UiUser[]>([]);
    const [roles, setRoles] = React.useState<any[]>([]); // pass-through; RolesTab normalizes
    const [loading, setLoading] = React.useState(false);
    const [loc, setLoc] = React.useState<LocalizationSettings | null>(null);

    const loadedRef = React.useRef(false);

    /* ---------------- Left Nav model (used for VALID_TABS) ---------------- */
    const navItemGroups = React.useMemo(
        () => [
            {
                title: "General",
                items: [
                    { v: "company", label: "Company", Icon: Building2 },
                    { v: "branding", label: "Branding", Icon: Palette },
                    { v: "localization", label: "Localization", Icon: Languages },
                    { v: "support", label: "Support & Legal", Icon: BookUser },
                ],
            },
            {
                title: "Access Management",
                items: [
                    { v: "users", label: "Users", Icon: Users },
                    { v: "roles", label: "Roles", Icon: ShieldCheck },
                    { v: "sso", label: "SSO", Icon: Lock },
                    { v: "security_policies", label: "Security Policies", Icon: LockKeyhole },
                    { v: "sessions", label: "Session Mgmt", Icon: UserCheck },
                    { v: "roles_matrix", label: "Roles Matrix", Icon: Table },
                ],
            },
            {
                title: "Billing",
                items: [
                    { v: "subscription", label: "Subscription", Icon: Gem },
                    { v: "billing", label: "Billing", Icon: CreditCard },
                    { v: "invoices", label: "Invoices", Icon: ReceiptText },
                ],
            },
            {
                title: "Communications",
                items: [
                    { v: "smtp", label: "SMTP", Icon: Mail },
                    { v: "notifications", label: "Notifications", Icon: BellRing },
                    { v: "templates", label: "Email Templates", Icon: FileSignature },
                ],
            },
            {
                title: "Infrastructure",
                items: [
                    { v: "system", label: "System", Icon: ServerCog },
                    { v: "database", label: "Database", Icon: Database },
                    { v: "storage", label: "Storage (S3)", Icon: Cloud },
                    { v: "backups", label: "Backups", Icon: ArchiveRestore },
                    { v: "agents", label: "Agents", Icon: Laptop2 },
                    { v: "migrations", label: "Data Migrations", Icon: DatabaseZap },
                ],
            },
            {
                title: "Advanced",
                items: [
                    { v: "audit", label: "Audit Logs", Icon: FileText },
                    { v: "api", label: "API", Icon: KeyRound },
                    { v: "integrations", label: "Integrations", Icon: Plug },
                    { v: "secrets", label: "Secrets", Icon: Vault },
                    { v: "workflows", label: "Workflows", Icon: Workflow },
                    { v: "import_export", label: "Import / Export", Icon: ArrowRightLeft },
                    { v: "custom_fields", label: "Custom Fields", Icon: ListPlus },
                    { v: "client_portal", label: "Client Portal", Icon: UserCog },
                    { v: "sla", label: "SLA", Icon: CalendarClock },
                    { v: "ticketing", label: "Ticketing", Icon: Ticket },
                    { v: "reports", label: "Reports", Icon: BarChart3 },
                    { v: "flags", label: "Feature Flags", Icon: Rocket },
                    { v: "compliance", label: "Compliance", Icon: Gavel },
                ],
            },
        ],
        []
    );

    // Build set of valid tab keys for validation
    const VALID_TABS = React.useMemo(
        () => new Set(navItemGroups.flatMap((g) => g.items.map((i) => i.v))),
        [navItemGroups]
    );

    // On first mount, derive initial tab from URL (?tab=) or localStorage
    React.useEffect(() => {
        const fromQuery = searchParams?.get("tab") || "";
        const fromStorage =
            typeof window !== "undefined" ? localStorage.getItem("admin.tab") || "" : "";

        const initial =
            (fromQuery && VALID_TABS.has(fromQuery)) ? fromQuery :
                (fromStorage && VALID_TABS.has(fromStorage)) ? fromStorage :
                    "company";

        setTab(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist tab changes to URL + localStorage
    React.useEffect(() => {
        if (!tab) return;

        if (typeof window !== "undefined") {
            localStorage.setItem("admin.tab", tab);
        }

        const current = new URLSearchParams(searchParams ? searchParams.toString() : "");
        current.set("tab", tab);
        router.replace(`?${current.toString()}`, { scroll: false });
    }, [tab, searchParams, router]);

    /* ---------------- Data fetching ---------------- */
    const refetchUsers = React.useCallback(async () => {
        try {
            const { items } = await getAdminUsers();
            setUsers(items.map(mapUserDTO));
        } catch (e: any) {
            push({
                title: "Failed to refresh users",
                desc: e?.message ?? "Internal server error",
                kind: "destructive",
            });
        }
    }, [push]);

    React.useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        (async () => {
            setLoading(true);
            try {
                const [usersRes, rolesRes, locRes] = await Promise.allSettled([
                    getAdminUsers(),
                    getAdminRoles(),
                    getLocalizationSettings(),
                ]);

                // Users
                if (usersRes.status === "fulfilled") {
                    const items = usersRes.value?.items ?? [];
                    setUsers(items.map(mapUserDTO));
                } else {
                    setUsers([]);
                    push({
                        title: "Failed to load users",
                        desc: (usersRes.reason as any)?.message ?? "Internal server error",
                        kind: "destructive",
                    });
                }

                // Roles — prefer full /api/roles if the admin listing is "short"
                if (rolesRes.status === "fulfilled") {
                    const maybe = Array.isArray((rolesRes.value as any)?.items)
                        ? (rolesRes.value as any).items
                        : Array.isArray(rolesRes.value)
                            ? (rolesRes.value as any)
                            : [];

                    const looksShort =
                        Array.isArray(maybe) &&
                        maybe.length > 0 &&
                        maybe[0] &&
                        maybe[0].description === undefined &&
                        maybe[0].permissions === undefined;

                    try {
                        const full = looksShort
                            ? await fetch(`${API_BASE}/roles`, {
                                cache: "no-store",
                                credentials: "include",
                            }).then((r) => {
                                if (!r.ok) throw new Error(`Failed to GET /roles (${r.status})`);
                                return r.json() as Promise<any[]>;
                            })
                            : maybe ?? [];

                        setRoles(full as any[]);
                    } catch (e: any) {
                        setRoles(maybe as any[]);
                        push({
                            title: "Failed to load role details",
                            desc: e?.message ?? "Request failed",
                            kind: "destructive",
                        });
                    }
                } else {
                    setRoles([]);
                    push({
                        title: "Failed to load roles",
                        desc: (rolesRes.reason as any)?.message ?? "Internal server error",
                        kind: "destructive",
                    });
                }

                // Localization
                if (locRes.status === "fulfilled") {
                    const apiLoc = locRes.value ?? null;
                    setLoc(apiLoc ? mapLocalization(apiLoc) : null);
                } else {
                    setLoc(null);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [push]);

    // Invite modal (optional)
    const [inviteOpen, setInviteOpen] = React.useState(false);
    const [inviteEmails, setInviteEmails] = React.useState("");

    function onInviteUsers() {
        const emails = inviteEmails
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean);
        if (!emails.length) {
            push({ title: "No emails provided", kind: "warning" });
            return;
        }
        setInviteEmails("");
        setInviteOpen(false);
        push({
            title: "Invitations queued",
            desc: `Sent to ${emails.length} recipient(s).`,
            kind: "success",
        });
    }

    const [removeUserId, setRemoveUserId] = React.useState<string | null>(null);
    const [reset2FAUserId, setReset2FAUserId] = React.useState<string | null>(null);

    async function onConfirmRemoveUser() {
        if (!removeUserId) return;
        const id = removeUserId;
        setRemoveUserId(null);

        const before = users;
        setUsers((prev) => prev.filter((p) => p.id !== id));
        try {
            await removeUser(id);
            await refetchUsers();
            push({ title: "User deleted", kind: "success" });
        } catch (e: any) {
            setUsers(before);
            push({
                title: "Failed to delete user",
                desc: e?.message ?? "Request failed",
                kind: "destructive",
            });
        }
    }

    /* ---------------- Left Nav UI state ---------------- */
    const [openGroups, setOpenGroups] = React.useState<string[]>([]);

    React.useEffect(() => {
        const currentGroup = navItemGroups.find((g) =>
            g.items.some((item) => item.v === tab)
        );
        if (currentGroup) {
            setOpenGroups((prev) =>
                prev.includes(currentGroup.title) ? prev : [...prev, currentGroup.title]
            );
        }
    }, [tab, navItemGroups]);

    const toggleGroup = (title: string) => {
        setOpenGroups((prev) =>
            prev.includes(title) ? prev.filter((g) => g !== title) : [...prev, title]
        );
    };

    return (
        <main className="p-4 sm:p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6">
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Shield className="h-5 w-5" /> Administration
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Organization-wide settings, users, roles, storage, billing and system
                        controls.
                    </p>
                </div>

                <Tabs
                    value={tab}
                    onValueChange={setTab}
                    className="grid grid-cols-[240px_1fr] items-start gap-6"
                >
                    {/* Left rail */}
                    <aside className="w-[240px] shrink-0 self-start sticky top-[70px] sm:top-[70px]">
                        <Card>
                            <TabsList className="flex h-auto w-full flex-col items-start justify-start gap-1 bg-transparent p-2">
                                {navItemGroups.map((group, groupIndex) => (
                                    <div
                                        key={group.title}
                                        className={cn("w-full", groupIndex > 0 && "border-t mt-2 pt-2")}
                                    >
                                        <button
                                            onClick={() => toggleGroup(group.title)}
                                            className="w-full flex items-center justify-start gap-2 rounded-md px-2 py-2 text-sm font-semibold text-foreground hover:bg-muted/50"
                                        >
                                            <ChevronDown
                                                className={cn(
                                                    "h-4 w-4 transition-transform text-muted-foreground",
                                                    openGroups.includes(group.title) ? "rotate-0" : "-rotate-90"
                                                )}
                                            />
                                            {group.title}
                                        </button>
                                        {group.items.map(({ v, label, Icon }) => {
                                            const isOpen = openGroups.includes(group.title);
                                            const isActive = tab === v;
                                            if (!isOpen && !isActive) return null;
                                            return (
                                                <TabsTrigger
                                                    key={v}
                                                    value={v}
                                                    className="w-full justify-start rounded-md border-l-2 border-transparent px-3 py-2 pl-8 text-sm text-muted-foreground hover:bg-muted/50 data-[state=active]:border-l-primary data-[state=active]:bg-primary/10 data-[state=active]:font-semibold data-[state=active]:text-primary"
                                                >
                                                    <Icon className="mr-2 h-4 w-4" />
                                                    {label}
                                                </TabsTrigger>
                                            );
                                        })}
                                    </div>
                                ))}
                            </TabsList>
                        </Card>
                    </aside>

                    {/* Right side */}
                    <div className="min-w-0 flex-1">
                        {tab === "users" && (
                            <UsersTab
                                users={users}
                                setUsers={setUsers}
                                roles={roles as any[]}
                                push={push}
                                setRemoveUserId={() => { }}
                                setReset2FAUserId={() => { }}
                                setInviteOpen={() => { }}
                                refetchUsers={refetchUsers}
                                localization={loc ?? undefined}
                            />
                        )}

                        {tab === "roles" && (
                            <RolesTab
                                roles={roles as any[]} // pass-through (keeps description + permissions)
                                setRoles={setRoles as any}
                                push={push}
                            />
                        )}

                        {tab === "company" && <CompanyTab push={push} />}
                        {tab === "branding" && <BrandingTab push={push} />}
                        {tab === "localization" && <LocalizationTab push={push} />}
                        {tab === "support" && <SupportTab push={push} />}

                        {tab === "subscription" && <SubscriptionTab push={push} />}
                        {tab === "billing" && <BillingTab push={push} />}
                        {tab === "invoices" && <InvoicesTab push={push} />}
                        {tab === "security_policies" && <SecurityPoliciesTab push={push} />}
                        {tab === "smtp" && <SmtpTab push={push} />}
                        {tab === "notifications" && <NotificationsTab push={push} />}
                        {tab === "templates" && <EmailTemplatesTab push={push} />}

                        {tab === "system" && <SystemTab push={push} />}
                        {tab === "database" && <DatabaseTab push={push} />}

                        {/* ⬇️ FIX: stop passing `push` to StorageTab and BackupsTab */}
                        {tab === "storage" && <StorageTab />}
                        {tab === "backups" && <BackupsTab />}

                        {tab === "agents" && <AgentsTab push={push} />}
                        {tab === "migrations" && <MigrationsTab push={push} />}

                        {tab === "audit" && <AuditLogsTab push={push} />}
                        {tab === "api" && <ApiTab push={push} />}
                        {tab === "integrations" && <IntegrationsTab push={push} />}
                        {tab === "secrets" && <SecretsTab push={push} />}
                        {tab === "workflows" && <WorkflowsTab push={push} />}
                        {tab === "import_export" && <ImportExportTab push={push} />}
                        {tab === "custom_fields" && <CustomFieldsTab push={push} />}
                        {tab === "client_portal" && <ClientPortalTab push={push} />}
                        {tab === "sla" && <SlaTab push={push} />}
                        {tab === "ticketing" && <TicketingTab push={push} />}
                        {tab === "reports" && <ReportsTab push={push} />}
                        {tab === "flags" && <FeatureFlagsTab push={push} />}
                        {tab === "compliance" && <ComplianceTab push={push} />}

                        {/* ✅ Sessions tab now imports the account version with matching props */}
                        {tab === "sessions" && (
                            <SessionsTab onDirtyChange={() => { }} saveHandleRef={() => { }} />
                        )}

                        {tab === "roles_matrix" && <RolesMatrixTab push={push} />}
                        {tab === "sso" && <SsoTab push={push} />}
                    </div>
                </Tabs>
            </div>

            {/* Invite dialog */}
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite users</DialogTitle>
                        <DialogDescription>
                            Enter one or more email addresses, separated by commas.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="invite-emails">Email addresses</Label>
                        <Input
                            id="invite-emails"
                            placeholder="alice@acme.com, bob@acme.com"
                            value={inviteEmails}
                            onChange={(e) => setInviteEmails(e.target.value)}
                        />
                    </div>
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setInviteOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="success" onClick={onInviteUsers}>
                            Send invites
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Toasts */}
            <div className="fixed bottom-4 right-4 z-[100] space-y-2">
                {toasts.map((t) => {
                    const klass =
                        t.kind === "success"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200"
                            : t.kind === "destructive"
                                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200"
                                : t.kind === "warning"
                                    ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-200"
                                    : "border-border bg-card text-card-foreground";
                    return (
                        <div
                            key={t.id}
                            className={cn("w-[340px] rounded-md border px-4 py-3 shadow-md", klass)}
                        >
                            <div className="text-sm font-medium">{t.title}</div>
                            {t.desc ? <div className="mt-1 text-xs opacity-90">{t.desc}</div> : null}
                        </div>
                    );
                })}
            </div>
        </main>
    );
}
