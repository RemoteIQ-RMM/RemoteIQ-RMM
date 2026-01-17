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

const API = process.env.NEXT_PUBLIC_API_BASE || "";

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
    const [draftTitle, setDraftTitle] = React.useState("");
    const [draftBody, setDraftBody] = React.useState("");
    const [draftActive, setDraftActive] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    const canWrite = !permDenied; // if you want to distinguish read vs write, handle 403 on write endpoints too

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
            const arr: AdminCannedResponse[] = Array.isArray(data?.items) ? data.items : [];
            setItems(arr);
        } catch (e: any) {
            setErr(e?.message ?? String(e));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadCanned();
    }, [loadCanned]);

    function openCreate() {
        setEditId(null);
        setDraftTitle("");
        setDraftBody("");
        setDraftActive(true);
        setModalOpen(true);
    }

    function openEdit(r: AdminCannedResponse) {
        setEditId(r.id);
        setDraftTitle(r.title);
        setDraftBody(r.body);
        setDraftActive(r.isActive);
        setModalOpen(true);
    }

    async function saveCanned() {
        const title = draftTitle.trim();
        const body = draftBody.trim();
        if (!title) {
            push({ title: "Title is required", kind: "error" });
            return;
        }
        if (!body) {
            push({ title: "Body is required", kind: "error" });
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
            push({ title: e?.message ?? String(e), kind: "error" });
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
            push({ title: e?.message ?? String(e), kind: "error" });
        }
    }

    return (
        <TabsContent value="ticketing">
            <Card>
                <CardHeader>
                    <CardTitle>Ticketing</CardTitle>
                    <CardDescription>
                        Configure queues, categories, priorities, email-to-ticket settings, and canned responses.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
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

                    {/* ✅ Canned Responses */}
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-medium">Canned Responses</h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Pre-written responses technicians can insert into ticket replies. Only approved roles can manage these.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    onClick={loadCanned}
                                    disabled={loading}
                                >
                                    Refresh
                                </Button>

                                <Button
                                    variant="success"
                                    onClick={openCreate}
                                    disabled={loading || permDenied || !canWrite}
                                >
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
                                                            r.isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
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
                                                        <Button
                                                            variant="outline"
                                                            onClick={() => openEdit(r)}
                                                            disabled={permDenied || saving}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            onClick={() => deleteCanned(r.id)}
                                                            disabled={permDenied || saving}
                                                        >
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

                    {/* Keep existing save button (stubbed) */}
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

            {/* Create/Edit Modal */}
            <Dialog open={modalOpen} onOpenChange={(v) => !saving && setModalOpen(v)}>
                <DialogContent className="sm:max-w-[720px]">
                    <DialogHeader>
                        <DialogTitle>{editId ? "Edit canned response" : "New canned response"}</DialogTitle>
                        <DialogDescription>
                            This will appear in the ticket reply composer’s canned responses dropdown.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Title</label>
                            <Input
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                placeholder="Example: Reboot request"
                                disabled={saving}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Body</label>
                            <textarea
                                className="min-h-[200px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-primary"
                                value={draftBody}
                                onChange={(e) => setDraftBody(e.target.value)}
                                placeholder="Type the canned response text…"
                                disabled={saving}
                            />
                        </div>

                        <div className="pt-1">
                            <CheckToggle
                                label="Active (visible to technicians)"
                                checked={draftActive}
                                onChange={(v: boolean) => setDraftActive(v)}
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
        </TabsContent>
    );
}
