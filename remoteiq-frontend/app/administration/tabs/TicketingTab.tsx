// remoteiq-frontend/app/administration/tabs/TicketingTab.tsx
"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { LabeledInput, CheckToggle } from "../helpers";
import { Separator } from "@/components/ui/separator";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TicketingTabProps = {
    push: (t: any) => void;
};

type AdminCannedResponse = {
    id: string;
    title: string;
    body: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};

type AdminCannedVariable = {
    id: string;
    key: string;
    value: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};

type PresetVar = {
    group: string;
    key: string; // e.g. "ticket.number"
    label: string;
    desc: string;
};

const API = process.env.NEXT_PUBLIC_API_BASE || "";

const token = (k: string) => `{{${k}}}`;
const customToken = (k: string) => `{{custom.${k}}}`;

const PRESET_VARIABLES: PresetVar[] = [
    // Ticket
    { group: "Ticket", key: "ticket.id", label: "Ticket UUID", desc: "Full ticket UUID." },
    { group: "Ticket", key: "ticket.number", label: "Ticket number", desc: "Numeric ticket number (if available)." },
    { group: "Ticket", key: "ticket.title", label: "Ticket title", desc: "Ticket subject/title." },
    { group: "Ticket", key: "ticket.status", label: "Ticket status", desc: "open / in_progress / resolved / closed." },
    { group: "Ticket", key: "ticket.priority", label: "Ticket priority", desc: "low / medium / high / urgent." },
    { group: "Ticket", key: "ticket.dueAt", label: "Ticket due date/time", desc: "Due date/time (if set)." },

    // Requester
    { group: "People", key: "requester.name", label: "Requester name", desc: "Requester display name (best-effort)." },
    { group: "People", key: "requester.email", label: "Requester email", desc: "Requester email (best-effort)." },

    // Assignee
    { group: "People", key: "assignee.name", label: "Assignee name", desc: "Assignee display name (best-effort)." },
    { group: "People", key: "assignee.email", label: "Assignee email", desc: "Assignee email (best-effort)." },

    // Time
    { group: "Time", key: "now.datetime", label: "Now (date/time)", desc: "Current date/time in America/New_York." },
    { group: "Time", key: "now.date", label: "Now (date)", desc: "Current date in America/New_York." },
    { group: "Time", key: "now.time", label: "Now (time)", desc: "Current time in America/New_York." },
    { group: "Time", key: "now.iso", label: "Now (ISO)", desc: "Server time as ISO string." },

    // Company (matches CompanyTab fields)
    { group: "Company", key: "company.name", label: "Company Name", desc: "Company display name." },
    { group: "Company", key: "company.legalName", label: "Legal Name", desc: "Legal company name." },
    { group: "Company", key: "company.email", label: "Company Email", desc: "Company contact email." },
    { group: "Company", key: "company.phone", label: "Company Phone", desc: "Company contact phone." },
    { group: "Company", key: "company.fax", label: "Company Fax", desc: "Company fax number." },
    { group: "Company", key: "company.website", label: "Company Website", desc: "Company website URL." },
    { group: "Company", key: "company.vatTin", label: "VAT / TIN", desc: "Tax / VAT identifier." },
    { group: "Company", key: "company.address1", label: "Address Line 1", desc: "Company address line 1." },
    { group: "Company", key: "company.address2", label: "Address Line 2", desc: "Company address line 2." },
    { group: "Company", key: "company.city", label: "City", desc: "Company city." },
    { group: "Company", key: "company.state", label: "State / Province", desc: "Company state/province." },
    { group: "Company", key: "company.postal", label: "Postal Code", desc: "Company postal/zip." },
    { group: "Company", key: "company.country", label: "Country", desc: "Company country." },

    // Branding (best effort; only works if backend supports these)
    { group: "Branding", key: "branding.primaryColor", label: "Primary color", desc: "Branding primary color." },
    { group: "Branding", key: "branding.secondaryColor", label: "Secondary color", desc: "Branding secondary color." },
    { group: "Branding", key: "branding.logoUrl", label: "Logo URL", desc: "Brand logo URL." },
    { group: "Branding", key: "branding.emailHeader", label: "Email header", desc: "Brand email header HTML/text." },
    { group: "Branding", key: "branding.emailFooter", label: "Email footer", desc: "Brand email footer HTML/text." },
];

const GROUP_ORDER = ["Ticket", "People", "Time", "Company", "Branding"];

async function safeReadErrorMessage(res: Response): Promise<string> {
    try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
            const j = await res.json();
            return String(j?.message ?? j?.error ?? "").trim();
        }
        const t = await res.text();
        return String(t ?? "").trim();
    } catch {
        return "";
    }
}

function fmtWhen(iso?: string | null) {
    if (!iso) return "-";
    const d = new Date(iso);
    return isFinite(d.getTime()) ? d.toLocaleString() : "-";
}

function groupPresets(list: PresetVar[]) {
    const map = new Map<string, PresetVar[]>();
    for (const v of list) {
        const arr = map.get(v.group) ?? [];
        arr.push(v);
        map.set(v.group, arr);
    }

    const out: Array<{ group: string; vars: PresetVar[] }> = [];
    for (const g of GROUP_ORDER) {
        const vars = map.get(g);
        if (vars && vars.length) out.push({ group: g, vars });
    }
    for (const [g, vars] of map.entries()) {
        if (!GROUP_ORDER.includes(g)) out.push({ group: g, vars });
    }
    return out;
}

function PresetVarBrowser({
    push,
    onInsert,
    className,
    scrollable,
}: {
    push: (t: any) => void;
    onInsert?: (tok: string) => void;
    className?: string;
    scrollable?: boolean;
}) {
    const grouped = React.useMemo(() => groupPresets(PRESET_VARIABLES), []);

    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            push({ title: "Copied", desc: text, kind: "success" });
        } catch {
            push({ title: "Copy failed", desc: "Clipboard permission denied.", kind: "destructive" });
        }
    }

    return (
        <div className={cn("rounded-md border bg-muted/20 overflow-hidden", className)}>
            <div className="px-3 py-2 border-b bg-muted/10">
                <div className="text-sm font-medium">Preset variables</div>
                <div className="text-xs text-muted-foreground mt-1">
                    Click <span className="font-medium">Copy</span> or <span className="font-medium">Insert</span>. Example:{" "}
                    <span className="font-mono">{token("ticket.number")}</span>
                </div>
            </div>

            <div className={cn("p-3", scrollable ? "max-h-[62vh] overflow-y-auto pr-2" : "")}>
                <div className="space-y-4">
                    {grouped.map(({ group, vars }) => (
                        <div key={group} className="space-y-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {group}
                            </div>

                            <ul className="grid gap-2 md:grid-cols-2">
                                {vars.map((v) => {
                                    const t = token(v.key);
                                    return (
                                        <li key={v.key} className="rounded-md border bg-background p-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-medium">{v.label}</div>
                                                    <div className="mt-1 font-mono text-xs break-all">{t}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{v.desc}</div>
                                                </div>

                                                <div className="shrink-0 flex items-center gap-2">
                                                    <Button
                                                        variant="outline"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() => copy(t)}
                                                        type="button"
                                                    >
                                                        Copy
                                                    </Button>
                                                    {onInsert ? (
                                                        <Button
                                                            variant="outline"
                                                            className="h-7 px-2 text-xs"
                                                            onClick={() => onInsert(t)}
                                                            type="button"
                                                        >
                                                            Insert
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function normalizeCannedResponse(x: any): AdminCannedResponse {
    return {
        id: String(x?.id ?? ""),
        title: String(x?.title ?? ""),
        body: String(x?.body ?? ""),
        isActive: !!(x?.isActive ?? x?.is_active ?? true),
        createdAt: String(x?.createdAt ?? x?.created_at ?? ""),
        updatedAt: String(x?.updatedAt ?? x?.updated_at ?? ""),
    };
}

function normalizeCannedVariable(x: any): AdminCannedVariable {
    return {
        id: String(x?.id ?? ""),
        key: String(x?.key ?? ""),
        value: String(x?.value ?? ""),
        isActive: !!(x?.isActive ?? x?.is_active ?? true),
        createdAt: String(x?.createdAt ?? x?.created_at ?? ""),
        updatedAt: String(x?.updatedAt ?? x?.updated_at ?? ""),
    };
}

export default function TicketingTab({ push }: TicketingTabProps) {
    // Existing stub settings (we’ll wire these later if desired)
    const [emailToTicketEnabled, setEmailToTicketEnabled] = React.useState(true);
    const [ingestionEmail, setIngestionEmail] = React.useState("support@your-msp.remoteiq.com");
    const [categories, setCategories] = React.useState("Incidents, Service Requests, Networking, Hardware");
    const [priorities, setPriorities] = React.useState("Low, Medium, High, Critical");

    // Canned Responses state
    const [loading, setLoading] = React.useState(true);
    const [items, setItems] = React.useState<AdminCannedResponse[]>([]);
    const [err, setErr] = React.useState<string | null>(null);
    const [permDenied, setPermDenied] = React.useState(false);

    const [modalOpen, setModalOpen] = React.useState(false);
    const [editId, setEditId] = React.useState<string | null>(null);
    const [draftTitle, setDraftTitle] = React.useState<string>("");
    const [draftBody, setDraftBody] = React.useState<string>("");
    const [draftActive, setDraftActive] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    // Variables state
    const [varLoading, setVarLoading] = React.useState(true);
    const [varItems, setVarItems] = React.useState<AdminCannedVariable[]>([]);
    const [varErr, setVarErr] = React.useState<string | null>(null);
    const [varPermDenied, setVarPermDenied] = React.useState(false);

    const [varModalOpen, setVarModalOpen] = React.useState(false);
    const [varEditId, setVarEditId] = React.useState<string | null>(null);
    const [varDraftKey, setVarDraftKey] = React.useState<string>("");
    const [varDraftValue, setVarDraftValue] = React.useState<string>("");
    const [varDraftActive, setVarDraftActive] = React.useState(true);
    const [varSaving, setVarSaving] = React.useState(false);

    const canWrite = !permDenied && !varPermDenied;

    const loadCanned = React.useCallback(async () => {
        setLoading(true);
        setErr(null);
        setPermDenied(false);
        try {
            const res = await fetch(`${API}/api/admin/ticketing/canned-responses`, { credentials: "include" });
            if (res.status === 403) {
                setPermDenied(true);
                setItems([]);
                return;
            }
            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Failed to load canned responses (${res.status})`);
            }

            const data = await res.json();
            const raw: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
            const arr = raw.map(normalizeCannedResponse).filter((x) => x.id);
            setItems(arr);
        } catch (e: any) {
            setErr(e?.message ?? String(e));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadVars = React.useCallback(async () => {
        setVarLoading(true);
        setVarErr(null);
        setVarPermDenied(false);
        try {
            const res = await fetch(`${API}/api/admin/ticketing/canned-variables`, { credentials: "include" });
            if (res.status === 403) {
                setVarPermDenied(true);
                setVarItems([]);
                return;
            }
            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Failed to load variables (${res.status})`);
            }

            const data = await res.json();
            const raw: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
            const arr = raw.map(normalizeCannedVariable).filter((x) => x.id);
            setVarItems(arr);
        } catch (e: any) {
            setVarErr(e?.message ?? String(e));
            setVarItems([]);
        } finally {
            setVarLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadCanned();
        loadVars();
    }, [loadCanned, loadVars]);

    function openCreate() {
        setEditId(null);
        setDraftTitle("");
        setDraftBody("");
        setDraftActive(true);
        setModalOpen(true);
    }

    function openEdit(r: AdminCannedResponse) {
        setEditId(r.id);
        setDraftTitle(String(r.title ?? ""));
        setDraftBody(String(r.body ?? ""));
        setDraftActive(!!r.isActive);
        setModalOpen(true);
    }

    async function saveCanned() {
        const title = String(draftTitle ?? "").trim();
        const body = String(draftBody ?? "").trim();

        if (!title) {
            push({ title: "Title is required", kind: "destructive" });
            return;
        }
        if (!body) {
            push({ title: "Body is required", kind: "destructive" });
            return;
        }

        setSaving(true);
        try {
            if (!editId) {
                const res = await fetch(`${API}/api/admin/ticketing/canned-responses`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title, body, isActive: draftActive }),
                });
                if (!res.ok) {
                    const msg = await safeReadErrorMessage(res);
                    throw new Error(msg || `Create failed (${res.status})`);
                }
                push({ title: "Canned response created", kind: "success" });
            } else {
                const res = await fetch(`${API}/api/admin/ticketing/canned-responses/${encodeURIComponent(editId)}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title, body, isActive: draftActive }),
                });
                if (!res.ok) {
                    const msg = await safeReadErrorMessage(res);
                    throw new Error(msg || `Update failed (${res.status})`);
                }
                push({ title: "Canned response updated", kind: "success" });
            }

            setModalOpen(false);
            await loadCanned();
        } catch (e: any) {
            push({ title: e?.message ?? String(e), kind: "destructive" });
        } finally {
            setSaving(false);
        }
    }

    async function deleteCanned(id: string) {
        const ok = confirm("Delete this canned response? This cannot be undone.");
        if (!ok) return;

        try {
            const res = await fetch(`${API}/api/admin/ticketing/canned-responses/${encodeURIComponent(id)}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Delete failed (${res.status})`);
            }
            push({ title: "Canned response deleted", kind: "success" });
            await loadCanned();
        } catch (e: any) {
            push({ title: e?.message ?? String(e), kind: "destructive" });
        }
    }

    function openVarCreate() {
        setVarEditId(null);
        setVarDraftKey("");
        setVarDraftValue("");
        setVarDraftActive(true);
        setVarModalOpen(true);
    }

    function openVarEdit(v: AdminCannedVariable) {
        setVarEditId(v.id);
        setVarDraftKey(String(v.key ?? ""));
        setVarDraftValue(String(v.value ?? ""));
        setVarDraftActive(!!v.isActive);
        setVarModalOpen(true);
    }

    async function saveVar() {
        const key = String(varDraftKey ?? "").trim();
        const value = String(varDraftValue ?? "").trim();

        if (!key) {
            push({ title: "Key is required", kind: "destructive" });
            return;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) {
            push({ title: "Key must match: ^[a-zA-Z][a-zA-Z0-9_-]*$", kind: "destructive" });
            return;
        }
        if (!value) {
            push({ title: "Value is required", kind: "destructive" });
            return;
        }

        setVarSaving(true);
        try {
            if (!varEditId) {
                const res = await fetch(`${API}/api/admin/ticketing/canned-variables`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key, value, isActive: varDraftActive }),
                });
                if (!res.ok) {
                    const msg = await safeReadErrorMessage(res);
                    throw new Error(msg || `Create failed (${res.status})`);
                }
                push({ title: "Variable created", kind: "success" });
            } else {
                const res = await fetch(`${API}/api/admin/ticketing/canned-variables/${encodeURIComponent(varEditId)}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key, value, isActive: varDraftActive }),
                });
                if (!res.ok) {
                    const msg = await safeReadErrorMessage(res);
                    throw new Error(msg || `Update failed (${res.status})`);
                }
                push({ title: "Variable updated", kind: "success" });
            }

            setVarModalOpen(false);
            await loadVars();
        } catch (e: any) {
            push({ title: e?.message ?? String(e), kind: "destructive" });
        } finally {
            setVarSaving(false);
        }
    }

    async function deleteVar(id: string) {
        const ok = confirm("Delete this variable? This cannot be undone.");
        if (!ok) return;

        try {
            const res = await fetch(`${API}/api/admin/ticketing/canned-variables/${encodeURIComponent(id)}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Delete failed (${res.status})`);
            }
            push({ title: "Variable deleted", kind: "success" });
            await loadVars();
        } catch (e: any) {
            push({ title: e?.message ?? String(e), kind: "destructive" });
        }
    }

    return (
        <TabsContent value="ticketing">
            <Card>
                <CardHeader>
                    <CardTitle>Ticketing</CardTitle>
                    <CardDescription>
                        Configure email-to-ticket, categories/priorities, canned responses, and template variables.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    <PresetVarBrowser push={push} />

                    <Separator />

                    {/* Email-to-ticket (still stubbed UI) */}
                    <div>
                        <h3 className="text-sm font-medium mb-2">Email to Ticket</h3>
                        <div className="p-4 border rounded-md space-y-4">
                            <CheckToggle
                                label="Enable Email-to-Ticket"
                                checked={emailToTicketEnabled}
                                onChange={(v: boolean) => setEmailToTicketEnabled(v)}
                            />
                            <LabeledInput
                                label="Ingestion Email Address"
                                value={ingestionEmail}
                                onChange={(v: string) => setIngestionEmail(v)}
                            />
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h3 className="text-sm font-medium mb-2">Ticket Categories</h3>
                        <LabeledInput
                            label="Categories (comma-separated)"
                            value={categories}
                            onChange={(v: string) => setCategories(v)}
                        />
                    </div>

                    <div>
                        <h3 className="text-sm font-medium mb-2">Ticket Priorities</h3>
                        <LabeledInput
                            label="Priorities (comma-separated)"
                            value={priorities}
                            onChange={(v: string) => setPriorities(v)}
                        />
                    </div>

                    <Separator />

                    {/* Custom Variables */}
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-medium">Custom Variables</h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Define admin-managed custom variables used in canned responses. Reference them like{" "}
                                    <span className="font-mono">{customToken("companyName")}</span>.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button variant="outline" onClick={loadVars} disabled={varLoading}>
                                    Refresh
                                </Button>
                                <Button variant="success" onClick={openVarCreate} disabled={varLoading || varPermDenied || !canWrite}>
                                    + New
                                </Button>
                            </div>
                        </div>

                        {(varPermDenied || permDenied) && (
                            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                                You don’t have permission to view/manage variables. Required permission:{" "}
                                <span className="font-mono">tickets.canned.read</span>
                            </div>
                        )}

                        {varErr && (
                            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                                {varErr}
                            </div>
                        )}

                        <div className="rounded-md border overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-muted/40">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold">Key</th>
                                            <th className="px-3 py-2 text-left font-semibold">Active</th>
                                            <th className="px-3 py-2 text-left font-semibold">Updated</th>
                                            <th className="px-3 py-2 text-right font-semibold">Actions</th>
                                        </tr>
                                    </thead>

                                    <tbody className="divide-y">
                                        {varLoading && (
                                            <tr>
                                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                                    Loading…
                                                </td>
                                            </tr>
                                        )}

                                        {!varLoading && !varPermDenied && varItems.length === 0 && (
                                            <tr>
                                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                                    No custom variables yet.
                                                </td>
                                            </tr>
                                        )}

                                        {!varLoading && varItems.map((v) => (
                                            <tr key={v.id} className="hover:bg-muted/20">
                                                <td className="px-3 py-2">
                                                    <div className="font-medium font-mono">{v.key}</div>
                                                    <div className="text-xs text-muted-foreground line-clamp-1">
                                                        Example usage:{" "}
                                                        <span className="font-mono">{customToken(v.key)}</span>
                                                    </div>
                                                </td>

                                                <td className="px-3 py-2">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                            v.isActive
                                                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                                                : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                                                        )}
                                                    >
                                                        {v.isActive ? "Yes" : "No"}
                                                    </span>
                                                </td>

                                                <td className="px-3 py-2 text-muted-foreground">
                                                    {fmtWhen(v.updatedAt)}
                                                </td>

                                                <td className="px-3 py-2">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button variant="outline" onClick={() => openVarEdit(v)} disabled={varSaving || varPermDenied}>
                                                            Edit
                                                        </Button>
                                                        <Button variant="destructive" onClick={() => deleteVar(v.id)} disabled={varSaving || varPermDenied}>
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Canned Responses */}
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-medium">Canned Responses</h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Pre-written responses technicians can insert. Preset variables + custom variables are supported.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button variant="outline" onClick={loadCanned} disabled={loading}>
                                    Refresh
                                </Button>

                                <Button variant="success" onClick={openCreate} disabled={loading || permDenied || !canWrite}>
                                    + New
                                </Button>
                            </div>
                        </div>

                        {permDenied && (
                            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                                You don’t have permission to view/manage canned responses. Required permission:{" "}
                                <span className="font-mono">tickets.canned.read</span>
                            </div>
                        )}

                        {err && (
                            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                                {err}
                            </div>
                        )}

                        <div className="rounded-md border overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-muted/40">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold">Title</th>
                                            <th className="px-3 py-2 text-left font-semibold">Active</th>
                                            <th className="px-3 py-2 text-left font-semibold">Updated</th>
                                            <th className="px-3 py-2 text-right font-semibold">Actions</th>
                                        </tr>
                                    </thead>

                                    <tbody className="divide-y">
                                        {loading && (
                                            <tr>
                                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                                    Loading…
                                                </td>
                                            </tr>
                                        )}

                                        {!loading && !permDenied && items.length === 0 && (
                                            <tr>
                                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                                    No canned responses yet.
                                                </td>
                                            </tr>
                                        )}

                                        {!loading && items.map((r) => (
                                            <tr key={r.id} className="hover:bg-muted/20">
                                                <td className="px-3 py-2">
                                                    <div className="font-medium">{r.title}</div>
                                                    <div className="text-xs text-muted-foreground line-clamp-1">
                                                        {r.body}
                                                    </div>
                                                </td>

                                                <td className="px-3 py-2">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                            r.isActive
                                                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                                                : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                                                        )}
                                                    >
                                                        {r.isActive ? "Yes" : "No"}
                                                    </span>
                                                </td>

                                                <td className="px-3 py-2 text-muted-foreground">
                                                    {fmtWhen(r.updatedAt)}
                                                </td>

                                                <td className="px-3 py-2">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button variant="outline" onClick={() => openEdit(r)} disabled={permDenied || saving}>
                                                            Edit
                                                        </Button>
                                                        <Button variant="destructive" onClick={() => deleteCanned(r.id)} disabled={permDenied || saving}>
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="text-right">
                        <Button
                            variant="success"
                            onClick={() => push({ title: "Ticketing settings saved", kind: "success" })}
                        >
                            Save Ticketing Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Canned Response Modal */}
            <Dialog open={modalOpen} onOpenChange={(v) => !saving && setModalOpen(v)}>
                <DialogContent className="sm:max-w-[1100px] max-h-[85vh] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>{editId ? "Edit canned response" : "New canned response"}</DialogTitle>
                        <DialogDescription>
                            Use preset variables like <span className="font-mono">{token("ticket.number")}</span> and custom variables like{" "}
                            <span className="font-mono">{customToken("companyName")}</span>.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_420px] h-[70vh]">
                        {/* LEFT: editor (scrolls if needed) */}
                        <div className="min-w-0 overflow-y-auto pr-1 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Title</label>
                                <Input
                                    value={draftTitle ?? ""}
                                    onChange={(e) => setDraftTitle(e.target.value)}
                                    placeholder="Example: Reboot request"
                                    disabled={saving}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Body</label>
                                <textarea
                                    className="min-h-[260px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-primary"
                                    value={draftBody ?? ""}
                                    onChange={(e) => setDraftBody(e.target.value)}
                                    placeholder="Type the canned response text…"
                                    disabled={saving}
                                />
                                <div className="text-xs text-muted-foreground">
                                    Tip: click Insert on the right to add a variable into your body.
                                </div>
                            </div>

                            <div className="pt-1">
                                <CheckToggle
                                    label="Active (visible to technicians)"
                                    checked={draftActive}
                                    onChange={(v: boolean) => setDraftActive(v)}
                                />
                            </div>

                            {varItems.length > 0 && (
                                <div className="rounded-md border bg-muted/20 p-3">
                                    <div className="text-sm font-medium mb-1">Custom variables</div>
                                    <div className="grid gap-2 md:grid-cols-2 text-xs">
                                        {varItems
                                            .filter((v) => v.isActive)
                                            .map((v) => (
                                                <div
                                                    key={v.id}
                                                    className="flex items-center justify-between gap-2 rounded-md border bg-background p-2"
                                                >
                                                    <div className="font-mono break-all">{customToken(v.key)}</div>
                                                    <Button
                                                        variant="outline"
                                                        className="h-7 px-2 text-xs"
                                                        type="button"
                                                        onClick={() =>
                                                            setDraftBody((b) =>
                                                                (b ?? "").trim()
                                                                    ? `${b}\n${customToken(v.key)}`
                                                                    : customToken(v.key)
                                                            )
                                                        }
                                                    >
                                                        Insert
                                                    </Button>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT: variables panel (its own scrollbar) */}
                        <div className="min-w-0 flex flex-col overflow-hidden">
                            <PresetVarBrowser
                                push={push}
                                onInsert={(tok) =>
                                    setDraftBody((b) => ((b ?? "").trim() ? `${b}\n${tok}` : tok))
                                }
                                className="h-full"
                                scrollable
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button variant="success" onClick={saveCanned} disabled={saving}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Variable Modal */}
            <Dialog open={varModalOpen} onOpenChange={(v) => !varSaving && setVarModalOpen(v)}>
                <DialogContent className="sm:max-w-[720px]">
                    <DialogHeader>
                        <DialogTitle>{varEditId ? "Edit variable" : "New variable"}</DialogTitle>
                        <DialogDescription>
                            Key must match <span className="font-mono">^[a-zA-Z][a-zA-Z0-9_-]*$</span>. Use it as{" "}
                            <span className="font-mono">{customToken("KEY")}</span>.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Key</label>
                            <Input
                                value={varDraftKey ?? ""}
                                onChange={(e) => setVarDraftKey(e.target.value)}
                                placeholder="Example: companyName"
                                disabled={varSaving}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Value</label>
                            <textarea
                                className="min-h-[160px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-primary"
                                value={varDraftValue ?? ""}
                                onChange={(e) => setVarDraftValue(e.target.value)}
                                placeholder="Example: Last Stop I.T. Solutions"
                                disabled={varSaving}
                            />
                        </div>

                        <div className="pt-1">
                            <CheckToggle
                                label="Active"
                                checked={varDraftActive}
                                onChange={(v: boolean) => setVarDraftActive(v)}
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setVarModalOpen(false)} disabled={varSaving}>
                            Cancel
                        </Button>
                        <Button variant="success" onClick={saveVar} disabled={varSaving}>
                            {varSaving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TabsContent>
    );
}
