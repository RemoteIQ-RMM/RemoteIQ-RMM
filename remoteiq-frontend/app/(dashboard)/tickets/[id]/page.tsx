// app/(dashboard)/tickets/[id]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { StatusPill, PriorityPill } from "@/components/pills";

/* -------------------------------- Types -------------------------------- */

type Ticket = {
    id: string;
    number?: string | null;
    title: string;
    description?: string | null;

    status: "open" | "pending" | "resolved" | "closed" | string;
    priority?: "low" | "normal" | "high" | "urgent" | string | null;

    requesterName?: string | null;
    requesterEmail?: string | null;

    assignedTo?: string | null; // display name or email
    assigneeUserId?: string | null;

    customerId?: string | null;
    client?: string | null;
    site?: string | null;
    deviceId?: string | null;

    createdAt?: string | null;
    updatedAt?: string | null;
    dueAt?: string | null;
    collaborators?: string[] | null;
};

type ActivityItem =
    | {
        id: string;
        kind: "message" | "note";
        author: string;
        body: string;
        createdAt: string;
        isInternal?: boolean;
        attachments?: { id: string; name: string; size?: number; url: string }[];
    }
    | {
        id: string;
        kind: "change";
        createdAt: string;
        actor: string;
        field: "status" | "priority" | "assignee" | "title" | "dueAt" | "collaborators";
        from?: string | null;
        to?: string | null;
    };

type CannedResponse = { id: string; title: string; body: string };
type LinkedTicket = { id: string; number?: string | null; title: string; status: string };
type HistoryItem = { at: string; who: string; what: string };

/* ----------------------------- Helpers --------------------------------- */

const API = process.env.NEXT_PUBLIC_API_BASE || "";

const shortId = (s: string) => s.slice(0, 8);
const fmtWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");
const pretty = (s?: string | null) => (!s || !s.trim() ? "-" : s.trim());

function SectionCard(props: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            {...props}
            className={cn("rounded-lg border border-zinc-700/50 bg-zinc-900 p-4", props.className)}
        />
    );
}

/* ----------------------------- Data hooks ------------------------------ */

function useTicket(id: string) {
    const [ticket, setTicket] = React.useState<Ticket | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const fetchTicket = React.useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const res = await fetch(`${API}/api/tickets/${id}`, { credentials: "include" });
            if (!res.ok) throw new Error(`Failed to load ticket (${res.status})`);
            const data: Ticket = await res.json();
            setTicket(data);
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setLoading(false);
        }
    }, [id]);

    React.useEffect(() => {
        fetchTicket();
    }, [fetchTicket]);

    return { ticket, setTicket, loading, error, refetch: fetchTicket };
}

function useTicketExtras(id: string) {
    const [activity, setActivity] = React.useState<ActivityItem[]>([]);
    const [canned, setCanned] = React.useState<CannedResponse[]>([]);
    const [linked, setLinked] = React.useState<LinkedTicket[]>([]);
    const [history, setHistory] = React.useState<HistoryItem[]>([]);
    const [loading, setLoading] = React.useState(true);

    const fetchExtras = React.useCallback(async () => {
        setLoading(true);
        try {
            const [a, c, l, h] = await Promise.all([
                fetch(`${API}/api/tickets/${id}/activity`, { credentials: "include" }),
                fetch(`${API}/api/tickets/canned-responses`, { credentials: "include" }),
                fetch(`${API}/api/tickets/${id}/linked`, { credentials: "include" }),
                fetch(`${API}/api/tickets/${id}/history`, { credentials: "include" }),
            ]);
            if (a.ok) setActivity(await a.json());
            if (c.ok) setCanned(await c.json());
            if (l.ok) setLinked(await l.json());
            if (h.ok) setHistory(await h.json());
        } finally {
            setLoading(false);
        }
    }, [id]);

    React.useEffect(() => {
        fetchExtras();
    }, [fetchExtras]);

    return { activity, canned, linked, history, loading, refetch: fetchExtras };
}

/* ------------------------ Options (dropdown data) ---------------------- */

type Option = { value: string; label: string };

// Tries endpoints in order until one returns 200. Maps items to Option via best-effort fields.
function useOptions(candidates: string[], mapper: (item: any) => Option | null) {
    const [options, setOptions] = React.useState<Option[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                for (const path of candidates) {
                    try {
                        const res = await fetch(`${API}${path}`, { credentials: "include" });
                        if (!res.ok) continue;
                        const data = await res.json();
                        const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
                        const mapped = arr
                            .map(mapper)
                            .filter((x): x is Option => !!x)
                            // dedupe by value
                            .filter((x, i, a) => a.findIndex((y) => y.value === x.value) === i);
                        if (!cancelled) setOptions(mapped);
                        break; // stop after first success
                    } catch {
                        // try next candidate
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [candidates.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

    return { options, loading };
}

// Mappers
const userMapper = (u: any): Option | null => {
    const label = (u?.name || u?.fullName || u?.email || u?.username || u?.id || "").toString().trim();
    if (!label) return null;
    return { value: label, label };
};

const clientMapper = (c: any): Option | null => {
    const label = (c?.name || c?.title || c?.displayName || c?.company || c?.id || "").toString().trim();
    if (!label) return null;
    return { value: label, label };
};

const siteMapper = (s: any): Option | null => {
    const label = (s?.name || s?.title || s?.label || s?.id || "").toString().trim();
    if (!label) return null;
    return { value: label, label };
};

const deviceMapper = (d: any): Option | null => {
    const label = (d?.hostname || d?.name || d?.title || d?.id || "").toString().trim();
    if (!label) return null;
    return { value: label, label };
};

/* ------------------------ Inline editable SELECT ----------------------- */

function EditableSelectRow({
    label,
    value,
    placeholder,
    options,
    saving,
    onSave,
}: {
    label: string;
    value?: string | null;
    placeholder: string;
    options: Option[];
    saving?: boolean;
    onSave: (v: string | null) => Promise<void> | void;
}) {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(value ?? "");
    const [pending, setPending] = React.useState(false);

    React.useEffect(() => {
        setDraft(value ?? "");
    }, [value]);

    const hasValue = !!(value && value.toString().trim());

    return (
        <div>
            <dt className="text-gray-400">{label}</dt>
            <dd className="mt-1">
                {!editing ? (
                    hasValue ? (
                        <button
                            className="font-medium text-gray-200 hover:underline underline-offset-2"
                            onClick={() => setEditing(true)}
                            title={`Edit ${label.toLowerCase()}`}
                        >
                            {value}
                        </button>
                    ) : (
                        <button
                            className="text-xs rounded-md border border-zinc-700 px-2 py-1 text-gray-300 hover:bg-zinc-800/70"
                            onClick={() => setEditing(true)}
                            title={`Set ${label.toLowerCase()}`}
                        >
                            + {placeholder}
                        </button>
                    )
                ) : (
                    <div className="flex items-center gap-2">
                        <select
                            className="h-8 w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-gray-200"
                            value={draft}
                            onChange={(e) => setDraft(e.currentTarget.value)}
                        >
                            <option value="">{placeholder}</option>
                            {options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        <button
                            disabled={pending || saving}
                            className="inline-flex h-8 items-center rounded-md border border-zinc-700 px-2 text-xs text-gray-200 hover:bg-zinc-800/70 disabled:opacity-50"
                            onClick={async () => {
                                try {
                                    setPending(true);
                                    await onSave(draft.trim() ? draft : null);
                                    setEditing(false);
                                } finally {
                                    setPending(false);
                                }
                            }}
                        >
                            Save
                        </button>
                        <button
                            className="inline-flex h-8 items-center rounded-md border border-zinc-700 px-2 text-xs text-gray-200 hover:bg-zinc-800/70"
                            onClick={() => {
                                setDraft(value ?? "");
                                setEditing(false);
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </dd>
        </div>
    );
}

/* -------------------------------- Page --------------------------------- */

export default function TicketDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const { ticket, setTicket, loading, error, refetch } = useTicket(id);
    const extras = useTicketExtras(id);

    // Dropdown data
    const users = useOptions(["/api/users"], userMapper);
    const clients = useOptions(["/api/clients", "/api/customers"], clientMapper);
    const sites = useOptions(["/api/sites", "/api/locations"], siteMapper);
    const devices = useOptions(["/api/devices"], deviceMapper);

    // Brand-aware buttons
    const btnBase =
        "font-semibold rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 inline-flex items-center justify-center";
    const btnPrimary =
        "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 focus:ring-[hsl(var(--primary))]";
    const btnSecondary = "bg-zinc-700 hover:bg-zinc-600 text-gray-200 focus:ring-zinc-500";

    const [savingField, setSavingField] = React.useState<string | null>(null);

    async function patchTicket(body: Partial<Ticket>, fieldName?: string) {
        if (!ticket) return;
        if (fieldName) setSavingField(fieldName);
        // optimistic
        setTicket({ ...ticket, ...body });
        const res = await fetch(`${API}/api/tickets/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) await refetch();
        await extras.refetch();
        if (fieldName) setSavingField(null);
    }

    const markResolved = () => patchTicket({ status: "resolved" });
    const markClosed = () => patchTicket({ status: "closed" });
    const reopen = () => patchTicket({ status: "open" });

    return (
        <div className="min-h-screen bg-zinc-950 text-gray-200 p-6 overflow-y-auto [scrollbar-gutter:stable]">
            {/* Header */}
            <header className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Link href="/tickets" className="hover:underline underline-offset-2">
                        Tickets
                    </Link>
                    <span>/</span>
                    <span className="truncate text-gray-200">{ticket?.title ?? shortId(id)}</span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        className={cn(btnBase, btnSecondary, "px-4 py-1.5 text-sm")}
                        onClick={() => {
                            refetch();
                            extras.refetch();
                        }}
                        title="Refresh"
                    >
                        Refresh
                    </button>
                    <button
                        className={cn(btnBase, btnPrimary, "px-4 py-1.5 text-sm")}
                        onClick={() => router.push("/tickets")}
                    >
                        Back to Tickets
                    </button>
                </div>
            </header>

            {loading && <SectionCard className="text-sm text-gray-300">Loading…</SectionCard>}

            {error && (
                <SectionCard className="text-sm border-red-700/30 bg-red-900/10 text-red-300">
                    {error}
                </SectionCard>
            )}

            {ticket && (
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Main column */}
                    <div className="space-y-6 lg:col-span-2">
                        <SectionCard>
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-xl font-semibold text-white">{ticket.title}</h1>
                                    <div className="mt-2 flex items-center gap-2">
                                        <StatusPill value={ticket.status} />
                                        <PriorityPill value={ticket.priority} />
                                        <span className="text-xs text-gray-400">
                                            # {ticket.number ?? shortId(ticket.id)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {ticket.status !== "resolved" && ticket.status !== "closed" ? (
                                        <>
                                            <button
                                                className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")}
                                                onClick={markResolved}
                                            >
                                                Mark as Resolved
                                            </button>
                                            <button
                                                className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")}
                                                onClick={markClosed}
                                            >
                                                Close
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")}
                                            onClick={reopen}
                                        >
                                            Reopen
                                        </button>
                                    )}
                                </div>
                            </div>

                            {ticket.description && (
                                <article className="prose prose-invert max-w-none">
                                    <p className="whitespace-pre-wrap">{ticket.description}</p>
                                </article>
                            )}
                        </SectionCard>

                        {/* Composer */}
                        <Composer
                            ticketId={ticket.id}
                            canned={extras.canned}
                            onSent={() => {
                                extras.refetch();
                                refetch();
                            }}
                            onAssignMe={(me) => patchTicket({ assignedTo: me })}
                            onChangePriority={(p) => patchTicket({ priority: p as any })}
                            btnBase={btnBase}
                            btnPrimary={btnPrimary}
                            btnSecondary={btnSecondary}
                        />

                        {/* Activity */}
                        <SectionCard>
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-base font-semibold text-white">Activity</h2>
                                <span className="text-xs text-gray-400">
                                    {extras.loading ? "Loading…" : `${extras.activity.length} item(s)`}
                                </span>
                            </div>

                            <ol className="space-y-4">
                                {extras.activity.map((a) =>
                                    a.kind === "change" ? (
                                        <li key={a.id} className="text-sm">
                                            <div className="flex items-start gap-3">
                                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-800 text-gray-300">
                                                    Change
                                                </span>
                                                <div className="flex-1">
                                                    <div className="text-gray-400">
                                                        {fmtWhen(a.createdAt)} • {a.actor}
                                                    </div>
                                                    <div className="text-gray-200">
                                                        <span className="font-medium">{a.field}</span>: {pretty(a.from)} →{" "}
                                                        {pretty(a.to)}
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ) : (
                                        <li key={a.id} className="text-sm">
                                            <div className="flex items-start gap-3">
                                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-300">
                                                    Reply
                                                </span>
                                                <div className="flex-1">
                                                    <div className="text-gray-400">
                                                        {fmtWhen(a.createdAt)} • {a.author}
                                                    </div>
                                                    <div className="mt-1 whitespace-pre-wrap text-gray-200">{a.body}</div>
                                                    {a.attachments && a.attachments.length > 0 && (
                                                        <ul className="mt-2 space-y-1">
                                                            {a.attachments.map((f) => (
                                                                <li key={f.id}>
                                                                    <a
                                                                        className="underline underline-offset-2 hover:opacity-80"
                                                                        href={f.url}
                                                                        target="_blank"
                                                                    >
                                                                        {f.name}
                                                                    </a>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    )
                                )}
                                {!extras.loading && extras.activity.length === 0 && (
                                    <li className="text-sm text-gray-400">No activity yet.</li>
                                )}
                            </ol>
                        </SectionCard>
                    </div>

                    {/* Right column */}
                    <div className="space-y-6">
                        <SectionCard>
                            <h3 className="mb-3 text-base font-semibold text-white">Ticket Details</h3>
                            <dl className="grid grid-cols-1 gap-3 text-sm">
                                <MetaRow label="Ticket #">{ticket.number ?? shortId(ticket.id)}</MetaRow>

                                <MetaRow label="Requester">
                                    {ticket.requesterName ?? ticket.requesterEmail ?? "-"}
                                </MetaRow>

                                {/* Assignee dropdown */}
                                <EditableSelectRow
                                    label="Assignee"
                                    value={ticket.assignedTo}
                                    placeholder="Select assignee"
                                    options={users.options}
                                    saving={savingField === "assignedTo"}
                                    onSave={(v) => patchTicket({ assignedTo: v }, "assignedTo")}
                                />

                                {/* Client dropdown */}
                                <EditableSelectRow
                                    label="Client"
                                    value={ticket.client}
                                    placeholder="Select client"
                                    options={clients.options}
                                    saving={savingField === "client"}
                                    onSave={(v) => patchTicket({ client: v as any }, "client")}
                                />

                                {/* Site dropdown */}
                                <EditableSelectRow
                                    label="Site"
                                    value={ticket.site}
                                    placeholder="Select site"
                                    options={sites.options}
                                    saving={savingField === "site"}
                                    onSave={(v) => patchTicket({ site: v as any }, "site")}
                                />

                                {/* Device dropdown */}
                                <EditableSelectRow
                                    label="Device"
                                    value={ticket.deviceId}
                                    placeholder="Select device"
                                    options={devices.options}
                                    saving={savingField === "deviceId"}
                                    onSave={(v) => patchTicket({ deviceId: v as any }, "deviceId")}
                                />

                                {/* Due date (datetime picker) */}
                                <InlineDateRow
                                    label="Due date"
                                    value={ticket.dueAt}
                                    onSave={(v) => patchTicket({ dueAt: v as any }, "dueAt")}
                                    saving={savingField === "dueAt"}
                                />

                                <MetaRow label="Updated">{fmtWhen(ticket.updatedAt)}</MetaRow>
                                <MetaRow label="Created">{fmtWhen(ticket.createdAt)}</MetaRow>

                                {/* Collaborators (keep as-is for now) */}
                                <div>
                                    <dt className="text-gray-400">Collaborators</dt>
                                    <dd className="mt-1 flex flex-wrap gap-2">
                                        {(ticket.collaborators ?? []).length === 0 && (
                                            <span className="text-gray-400">None</span>
                                        )}
                                        {(ticket.collaborators ?? []).map((c) => (
                                            <span
                                                key={c}
                                                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-800 text-gray-300"
                                            >
                                                {c}
                                            </span>
                                        ))}
                                    </dd>
                                    <div className="mt-2 flex gap-2">
                                        <SmallBtn
                                            className={cn(btnBase, btnSecondary)}
                                            onClick={async () => {
                                                const email = prompt("Add collaborator (email):");
                                                if (!email) return;
                                                await patchTicket({
                                                    collaborators: [...(ticket.collaborators ?? []), email],
                                                });
                                            }}
                                        >
                                            + Add collaborator
                                        </SmallBtn>
                                        {(ticket.collaborators ?? []).length > 0 && (
                                            <SmallBtn
                                                className={cn(btnBase, btnSecondary)}
                                                onClick={async () => {
                                                    const email = prompt("Remove which collaborator (email)?");
                                                    if (!email) return;
                                                    await patchTicket({
                                                        collaborators: (ticket.collaborators ?? []).filter((x) => x !== email),
                                                    });
                                                }}
                                            >
                                                Remove
                                            </SmallBtn>
                                        )}
                                    </div>
                                </div>
                            </dl>
                        </SectionCard>

                        <SectionCard>
                            <h3 className="mb-3 text-base font-semibold text-white">Linked tickets</h3>
                            <ul className="space-y-2 text-sm">
                                {extras.linked.map((lt) => (
                                    <li key={lt.id} className="flex items-center justify-between gap-2">
                                        <Link
                                            href={`/tickets/${lt.id}`}
                                            className="underline underline-offset-2 hover:opacity-80"
                                        >
                                            {lt.number ?? shortId(lt.id)} — {lt.title}
                                        </Link>
                                        <StatusPill value={lt.status} />
                                    </li>
                                ))}
                                {extras.linked.length === 0 && (
                                    <li className="text-gray-400">No linked tickets.</li>
                                )}
                            </ul>
                            <div className="mt-2">
                                <SmallBtn
                                    className={cn(btnBase, btnSecondary)}
                                    onClick={async () => {
                                        const other = prompt("Link ticket by ID:");
                                        if (!other) return;
                                        await fetch(`${API}/api/tickets/${id}/linked`, {
                                            method: "POST",
                                            credentials: "include",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ linkedId: other }),
                                        });
                                        extras.refetch();
                                    }}
                                >
                                    + Link a ticket
                                </SmallBtn>
                            </div>
                        </SectionCard>

                        <SectionCard>
                            <h3 className="mb-3 text-base font-semibold text-white">Ticket History</h3>
                            <ul className="space-y-2 text-sm">
                                {extras.history.map((h, i) => (
                                    <li key={i}>
                                        <div className="text-gray-400">{fmtWhen(h.at)}</div>
                                        <div className="text-gray-200">
                                            {h.what} — {h.who}
                                        </div>
                                    </li>
                                ))}
                                {extras.history.length === 0 && (
                                    <li className="text-gray-400">No history entries.</li>
                                )}
                            </ul>
                        </SectionCard>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ---------------------------- Small bits ---------------------------- */

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="text-gray-400">{label}</dt>
            <dd className="font-medium text-gray-200">{children}</dd>
        </div>
    );
}

function SmallBtn(
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }
) {
    return (
        <button
            {...props}
            className={cn(
                "inline-flex h-8 items-center rounded-md px-2 text-xs transition-colors",
                props.className
            )}
        />
    );
}

/* --------------------- Inline date editor (due date) ------------------- */

function InlineDateRow({
    label,
    value,
    onSave,
    saving,
}: {
    label: string;
    value?: string | null;
    onSave: (v: string | null) => Promise<void> | void;
    saving?: boolean;
}) {
    const [editing, setEditing] = React.useState(false);
    const [pending, setPending] = React.useState(false);

    const toLocalInput = (iso?: string | null) => {
        if (!iso) return "";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
            d.getHours()
        )}:${pad(d.getMinutes())}`;
    };
    const fromLocalInput = (v: string) => {
        if (!v.trim()) return null;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    };

    const [draft, setDraft] = React.useState(toLocalInput(value));
    React.useEffect(() => setDraft(toLocalInput(value)), [value]);

    const hasValue = !!(value && value.toString().trim());

    return (
        <div>
            <dt className="text-gray-400">{label}</dt>
            <dd className="mt-1">
                {!editing ? (
                    hasValue ? (
                        <button
                            className="font-medium text-gray-200 hover:underline underline-offset-2"
                            onClick={() => setEditing(true)}
                            title={`Edit ${label.toLowerCase()}`}
                        >
                            {fmtWhen(value)}
                        </button>
                    ) : (
                        <button
                            className="text-xs rounded-md border border-zinc-700 px-2 py-1 text-gray-300 hover:bg-zinc-800/70"
                            onClick={() => setEditing(true)}
                            title={`Set ${label.toLowerCase()}`}
                        >
                            + Set due date
                        </button>
                    )
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            type="datetime-local"
                            value={draft}
                            onChange={(e) => setDraft(e.currentTarget.value)}
                            className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-gray-200"
                        />
                        <button
                            disabled={pending || saving}
                            className="inline-flex h-8 items-center rounded-md border border-zinc-700 px-2 text-xs text-gray-200 hover:bg-zinc-800/70 disabled:opacity-50"
                            onClick={async () => {
                                try {
                                    setPending(true);
                                    await onSave(fromLocalInput(draft));
                                    setEditing(false);
                                } finally {
                                    setPending(false);
                                }
                            }}
                        >
                            Save
                        </button>
                        <button
                            className="inline-flex h-8 items-center rounded-md border border-zinc-700 px-2 text-xs text-gray-200 hover:bg-zinc-800/70"
                            onClick={() => {
                                setDraft(toLocalInput(value));
                                setEditing(false);
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </dd>
        </div>
    );
}

/* ----------------------------- Composer ----------------------------- */

function Composer({
    ticketId,
    canned,
    onSent,
    onAssignMe,
    onChangePriority,
    btnBase,
    btnPrimary,
    btnSecondary,
}: {
    ticketId: string;
    canned: CannedResponse[];
    onSent: () => void;
    onAssignMe: (meDisplay: string) => void;
    onChangePriority: (p: "low" | "normal" | "high" | "urgent") => void;
    btnBase: string;
    btnPrimary: string;
    btnSecondary: string;
}) {
    const [mode] = React.useState<"reply" | "note">("reply");
    const [body, setBody] = React.useState("");
    const [timeWorked, setTimeWorked] = React.useState(0);
    const [attach, setAttach] = React.useState<File[]>([]);
    const [assignToMe, setAssignToMe] = React.useState(false);
    const [changePriority, setChangePriority] =
        React.useState<"low" | "normal" | "high" | "urgent" | "">("");
    const [dontEmailCustomer, setDontEmailCustomer] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const timerRef = React.useRef<NodeJS.Timeout | null>(null);

    React.useEffect(() => {
        timerRef.current = setInterval(() => setTimeWorked((s) => s + 1), 1000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    function pickCanned(id: string) {
        const match = canned.find((c) => c.id === id);
        if (!match) return;
        setBody((b) => (b ? `${b}\n\n${match.body}` : match.body));
    }

    async function uploadFiles(): Promise<{ id: string; url: string; name: string }[]> {
        if (attach.length === 0) return [];
        const form = new FormData();
        attach.forEach((f) => form.append("files", f, f.name));
        const res = await fetch(`${API}/api/tickets/${ticketId}/attachments`, {
            method: "POST",
            credentials: "include",
            body: form,
        });
        if (!res.ok) throw new Error("File upload failed");
        return res.json();
    }

    async function submit(
        kind: "reply" | "note",
        submitAs?: "reply" | "reply_and_close" | "reply_and_resolve"
    ) {
        if (!body.trim() && attach.length === 0) return;
        setSubmitting(true);
        try {
            const files = await uploadFiles();
            const res = await fetch(`${API}/api/tickets/${ticketId}/${kind}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    body,
                    timeWorkedSeconds: timeWorked,
                    attachments: files,
                    notifyCustomer: kind === "reply" && !dontEmailCustomer,
                    submitAs,
                }),
            });
            if (!res.ok) throw new Error(`Submit failed (${res.status})`);

            if (assignToMe) onAssignMe("Me");
            if (changePriority) {
                onChangePriority(changePriority);
                setChangePriority("");
            }
            setBody("");
            setAttach([]);
            setTimeWorked(0);
            onSent();
        } catch (e) {
            alert((e as any)?.message ?? String(e));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <SectionCard>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                    <span className="rounded-md border border-zinc-700 px-3 py-1 text-gray-200 bg-zinc-800">
                        Reply
                    </span>
                </div>

                <div className="text-xs text-gray-400">
                    Time worked: <span className="tabular-nums">{formatHHMMSS(timeWorked)}</span>
                </div>
            </div>

            {/* Toolbar */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                    className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-gray-200"
                    onChange={(e) => pickCanned(e.currentTarget.value)}
                    defaultValue=""
                    title="Canned responses"
                >
                    <option value="" disabled>
                        Select a canned response…
                    </option>
                    {canned.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.title}
                        </option>
                    ))}
                </select>

                <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => setAttach(Array.from(e.currentTarget.files ?? []))}
                    />
                    <span className="rounded-md border border-zinc-700 px-3 py-1 text-gray-200 hover:bg-zinc-800/70">
                        Add file
                    </span>
                    {attach.length > 0 && (
                        <span className="text-xs text-gray-400">{attach.length} file(s)</span>
                    )}
                </label>
            </div>

            <textarea
                className="min-h-[160px] w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                placeholder="Type your reply…"
                value={body}
                onChange={(e) => setBody(e.currentTarget.value)}
            />

            {/* Footer controls */}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={assignToMe}
                            onChange={(e) => setAssignToMe(e.currentTarget.checked)}
                        />
                        Assign this ticket to me
                    </label>

                    <div className="flex items-center gap-2">
                        <span>Change priority to:</span>
                        <select
                            className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-gray-200"
                            value={changePriority}
                            onChange={(e) => setChangePriority(e.currentTarget.value as any)}
                        >
                            <option value="">(don’t change)</option>
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>

                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={dontEmailCustomer}
                            onChange={(e) => setDontEmailCustomer(e.currentTarget.checked)}
                        />
                        Don’t send email notification of this reply to the customer
                    </label>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                        className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                        disabled={submitting}
                        onClick={() => submit("reply")}
                    >
                        Submit reply
                    </button>
                    <button
                        className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")}
                        disabled={submitting}
                        onClick={() => submit("reply", "reply_and_resolve")}
                    >
                        Submit & Resolve
                    </button>
                    <button
                        className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")}
                        disabled={submitting}
                        onClick={() => submit("reply", "reply_and_close")}
                    >
                        Submit & Close
                    </button>
                </div>
            </div>
        </SectionCard>
    );
}

function formatHHMMSS(totalSeconds: number) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
