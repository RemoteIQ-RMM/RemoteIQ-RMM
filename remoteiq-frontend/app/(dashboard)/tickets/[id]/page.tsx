// app/(dashboard)/tickets/[id]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { StatusPill, PriorityPill } from "@/components/pills";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/* -------------------------------- Types -------------------------------- */

type Ticket = {
    id: string;
    number?: string | null;
    title: string;
    description?: string | null;

    status: "open" | "resolved" | "closed" | "in_progress" | string;
    priority?: "low" | "normal" | "medium" | "high" | "urgent" | string | null;

    requesterName?: string | null;
    requesterEmail?: string | null;

    assignedTo?: string | null; // legacy display
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

// Search results from /api/tickets (backend returns ticketNumber, etc.)
type SearchTicket = {
    id: string;
    title: string;
    status: string;
    ticketNumber?: number | null;
    number?: string | null;
};

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

/* ----------------------- Persistent Ticket Timer ------------------------ */
/**
 * Persists "time worked" per ticket while the ticket page is open.
 * - runs while open
 * - pauses on navigation away / tab hidden / close
 * - resumes when visible again
 * - DOES NOT reset after sending a reply/note
 */
function usePersistentTicketTimer(ticketId: string, enabled: boolean) {
    const storageKey = React.useMemo(() => `remoteiq.ticketTimer.${ticketId}`, [ticketId]);

    const [seconds, setSeconds] = React.useState<number>(() => {
        if (typeof window === "undefined") return 0;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) return 0;
            const parsed = JSON.parse(raw) as { seconds?: unknown } | null;
            return typeof parsed?.seconds === "number" && Number.isFinite(parsed.seconds) && parsed.seconds >= 0
                ? parsed.seconds
                : 0;
        } catch {
            return 0;
        }
    });

    const secondsRef = React.useRef(seconds);
    React.useEffect(() => {
        secondsRef.current = seconds;
    }, [seconds]);

    const enabledRef = React.useRef(enabled);
    React.useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);

    const intervalRef = React.useRef<number | null>(null);

    const persist = React.useCallback(
        (overrideSeconds?: number) => {
            if (typeof window === "undefined") return;
            const value = {
                seconds: typeof overrideSeconds === "number" ? overrideSeconds : secondsRef.current,
                updatedAt: Date.now(),
            };
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(value));
            } catch {
                // ignore storage failures
            }
        },
        [storageKey]
    );

    const start = React.useCallback(() => {
        if (typeof window === "undefined") return;
        if (!enabledRef.current) return;
        if (document.visibilityState === "hidden") return;
        if (intervalRef.current !== null) return;

        intervalRef.current = window.setInterval(() => {
            setSeconds((s) => s + 1);
        }, 1000);
    }, []);

    const pause = React.useCallback(() => {
        if (typeof window === "undefined") return;
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        persist();
    }, [persist]);

    // respond immediately when enabled changes (resolved/closed should stop timer)
    React.useEffect(() => {
        if (!enabled) {
            pause();
            return;
        }
        start();
    }, [enabled, pause, start]);

    React.useEffect(() => {
        const onVis = () => {
            if (document.visibilityState === "hidden") {
                pause();
                return;
            }
            // only resume if still enabled
            start();
        };

        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("beforeunload", pause);

        const t = window.setInterval(() => {
            // keep persisted even if running; cheap and helps crash scenarios
            persist();
        }, 5000);

        return () => {
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("beforeunload", pause);
            window.clearInterval(t);
            pause();
        };
    }, [pause, persist, start]);

    React.useEffect(() => {
        persist(seconds);
    }, [seconds, persist]);

    return { seconds, setSeconds, start, pause, persist };
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
                            .filter((x, i, a) => a.findIndex((y) => y.value === x.value) === i);
                        if (!cancelled) setOptions(mapped);
                        break;
                    } catch {
                        // try next
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidates.join("|")]);

    return { options, loading };
}

const userMapper = (u: any): Option | null => {
    const id = (u?.id ?? "").toString().trim();
    const label = (u?.name || u?.fullName || u?.email || u?.username || id || "").toString().trim();
    if (!id || !label) return null;
    return { value: id, label };
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
    const id = (d?.id ?? "").toString().trim();
    const label = (d?.hostname || d?.name || d?.title || id || "").toString().trim();
    if (!id || !label) return null;
    return { value: id, label };
};

const PRIORITY_OPTIONS: Option[] = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Normal" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
];

/* ------------------------ Inline editable SELECT ----------------------- */

function EditableSelectRow({
    label,
    value,
    placeholder,
    options,
    saving,
    onSave,
    displayValue,
}: {
    label: string;
    value?: string | null;
    placeholder: string;
    options: Option[];
    saving?: boolean;
    onSave: (v: string | null) => Promise<void> | void;
    displayValue?: string;
}) {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(value ?? "");
    const [pending, setPending] = React.useState(false);

    React.useEffect(() => {
        setDraft(value ?? "");
    }, [value]);

    const hasValue = !!(value && value.toString().trim());
    const labelForValue = displayValue ?? (hasValue ? options.find((o) => o.value === value)?.label ?? value : "");

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
                            {labelForValue}
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

/* ------------------------- Link Ticket Modal -------------------------- */

function TicketLinkModal({
    open,
    onOpenChange,
    currentTicketId,
    onLinked,
    btnBase,
    btnSecondary,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    currentTicketId: string;
    onLinked: () => void;
    btnBase: string;
    btnSecondary: string;
}) {
    const [q, setQ] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [results, setResults] = React.useState<SearchTicket[]>([]);
    const [err, setErr] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) {
            setQ("");
            setResults([]);
            setErr(null);
            setBusy(false);
        }
    }, [open]);

    React.useEffect(() => {
        if (!open) return;
        const needle = q.trim();
        if (!needle) {
            setResults([]);
            setErr(null);
            return;
        }

        let cancelled = false;
        const t = window.setTimeout(async () => {
            try {
                setBusy(true);
                setErr(null);

                const params = new URLSearchParams();
                params.set("search", needle);
                params.set("pageSize", "20");

                const res = await fetch(`${API}/api/tickets?${params.toString()}`, { credentials: "include" });
                if (!res.ok) throw new Error(`Search failed (${res.status})`);

                const raw = await res.json();
                const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];

                const mapped: SearchTicket[] = arr
                    .map((t: any) => ({
                        id: String(t?.id ?? ""),
                        title: String(t?.title ?? ""),
                        status: String(t?.status ?? ""),
                        ticketNumber: t?.ticketNumber !== undefined && t?.ticketNumber !== null ? Number(t.ticketNumber) : null,
                        number: t?.number ?? null,
                    }))
                    .filter((t) => t.id && t.title)
                    .filter((t) => t.id !== currentTicketId);

                if (!cancelled) setResults(mapped);
            } catch (e: any) {
                if (!cancelled) {
                    setErr(e?.message ?? String(e));
                    setResults([]);
                }
            } finally {
                if (!cancelled) setBusy(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [open, q, currentTicketId]);

    async function linkTicket(target: SearchTicket) {
        if (!target?.id) return;
        setBusy(true);
        setErr(null);
        try {
            const res = await fetch(`${API}/api/tickets/${currentTicketId}/linked`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkedId: target.id }), // send full UUID
            });

            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Link failed (${res.status})`);
            }

            onOpenChange(false);
            onLinked();
        } catch (e: any) {
            setErr(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[680px]">
                <DialogHeader>
                    <DialogTitle>Link a ticket</DialogTitle>
                    <DialogDescription>
                        Type a ticket number, title, or the first 8 characters of a ticket UUID, then click the ticket to link it.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <Input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Example: 1234  |  printer  |  d45157b8"
                        autoFocus
                    />

                    {err && (
                        <div className="rounded-md border border-red-700/40 bg-red-900/10 p-2 text-sm text-red-300">
                            {err}
                        </div>
                    )}

                    <div className="max-h-[340px] overflow-auto rounded-md border border-zinc-800">
                        {busy && <div className="p-3 text-sm text-gray-400">Searching…</div>}

                        {!busy && q.trim() && results.length === 0 && <div className="p-3 text-sm text-gray-400">No matches.</div>}

                        {!busy && results.length > 0 && (
                            <ul className="divide-y divide-zinc-800">
                                {results.map((t) => {
                                    const displayNum =
                                        t.ticketNumber !== null && t.ticketNumber !== undefined
                                            ? String(t.ticketNumber)
                                            : t.number ?? shortId(t.id);

                                    return (
                                        <li key={t.id}>
                                            <button
                                                type="button"
                                                className={cn(
                                                    "w-full text-left p-3 hover:bg-zinc-900/60 transition-colors",
                                                    "flex items-start justify-between gap-3"
                                                )}
                                                onClick={() => linkTicket(t)}
                                                disabled={busy}
                                                title="Click to link this ticket"
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-sm text-gray-200 truncate">
                                                        <span className="font-semibold">#{displayNum}</span>{" "}
                                                        <span className="text-gray-300">—</span>{" "}
                                                        <span>{t.title}</span>
                                                    </div>
                                                    <div className="mt-1 text-xs text-gray-500">
                                                        UUID: <span className="font-mono">{shortId(t.id)}</span>
                                                    </div>
                                                </div>
                                                <div className="shrink-0">
                                                    <StatusPill value={t.status} />
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {!q.trim() && <div className="p-3 text-sm text-gray-400">Start typing to search…</div>}
                    </div>
                </div>

                <DialogFooter>
                    <button
                        type="button"
                        className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")}
                        onClick={() => onOpenChange(false)}
                        disabled={busy}
                    >
                        Close
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

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

/* -------------------------------- Page --------------------------------- */

export default function TicketDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const { ticket, setTicket, loading, error, refetch } = useTicket(id);
    const extras = useTicketExtras(id);

    const users = useOptions(["/api/users"], userMapper);
    const clients = useOptions(["/api/clients", "/api/customers"], clientMapper);
    const sites = useOptions(["/api/sites", "/api/locations"], siteMapper);
    const devices = useOptions(["/api/devices"], deviceMapper);

    const btnBase =
        "font-semibold rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 inline-flex items-center justify-center";
    const btnPrimary =
        "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 focus:ring-[hsl(var(--primary))]";
    const btnSecondary = "bg-zinc-700 hover:bg-zinc-600 text-gray-200 focus:ring-zinc-500";

    const [savingField, setSavingField] = React.useState<string | null>(null);
    const [linkModalOpen, setLinkModalOpen] = React.useState(false);

    // Persistent time worked
    const timerEnabled = !ticket || (ticket.status !== "resolved" && ticket.status !== "closed");
    const timer = usePersistentTicketTimer(id, timerEnabled);


    async function patchTicket(body: Partial<Ticket>, fieldName?: string) {
        if (!ticket) return;
        if (fieldName) setSavingField(fieldName);
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

    const isResolvedOrClosed = ticket?.status === "resolved" || ticket?.status === "closed";
    const isClosed = ticket?.status === "closed";

    const markResolved = () => {
        if (!ticket || isResolvedOrClosed) return;
        return patchTicket({ status: "resolved" });
    };
    const markClosed = () => {
        if (!ticket || isResolvedOrClosed) return;
        return patchTicket({ status: "closed" });
    };
    const reopen = () => {
        if (!ticket) return;
        return patchTicket({ status: "open" });
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-gray-200 p-6 overflow-y-auto [scrollbar-gutter:stable]">
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
                    <div className="space-y-6 lg:col-span-2">
                        <SectionCard>
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-xl font-semibold text-white">{ticket.title}</h1>
                                    <div className="mt-2 flex items-center gap-2">
                                        <StatusPill value={ticket.status} />
                                        <PriorityPill value={ticket.priority} />
                                        <span className="text-xs text-gray-400"># {ticket.number ?? shortId(ticket.id)}</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {ticket.status !== "resolved" && ticket.status !== "closed" ? (
                                        <>
                                            <button
                                                className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                                                onClick={markResolved}
                                                disabled={isResolvedOrClosed}
                                            >
                                                Mark as Resolved
                                            </button>
                                            <button
                                                className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                                                onClick={markClosed}
                                                disabled={isResolvedOrClosed}
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

                        <Composer
                            ticketId={ticket.id}
                            ticketStatus={ticket.status}
                            canned={extras.canned}
                            onSent={() => {
                                extras.refetch();
                                refetch();
                            }}
                            btnBase={btnBase}
                            btnPrimary={btnPrimary}
                            btnSecondary={btnSecondary}
                            timeWorkedSeconds={timer.seconds}
                        />

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
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                        a.kind === "note"
                                                            ? "bg-amber-500/15 text-amber-300"
                                                            : "bg-blue-500/15 text-blue-300"
                                                    )}
                                                >
                                                    {a.kind === "note" ? "Note" : "Reply"}
                                                </span>
                                                <div className="flex-1">
                                                    <div className="text-gray-400">
                                                        {fmtWhen(a.createdAt)} • {a.author}{" "}
                                                        {a.isInternal ? "• Internal" : ""}
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

                    <div className="space-y-6">
                        <SectionCard>
                            <h3 className="mb-3 text-base font-semibold text-white">Ticket Details</h3>
                            <dl className="grid grid-cols-1 gap-3 text-sm">
                                <MetaRow label="Ticket #">{ticket.number ?? shortId(ticket.id)}</MetaRow>

                                <MetaRow label="Requester">{ticket.requesterName ?? ticket.requesterEmail ?? "-"}</MetaRow>

                                <EditableSelectRow
                                    label="Priority"
                                    value={(ticket.priority ?? "") as any}
                                    placeholder="Select priority"
                                    options={PRIORITY_OPTIONS}
                                    saving={savingField === "priority"}
                                    onSave={(v) => patchTicket({ priority: v as any }, "priority")}
                                />

                                <EditableSelectRow
                                    label="Assignee"
                                    value={ticket.assigneeUserId ?? ""}
                                    placeholder="Select assignee"
                                    options={users.options}
                                    saving={savingField === "assigneeUserId"}
                                    onSave={(v) => patchTicket({ assigneeUserId: v }, "assigneeUserId")}
                                />

                                <EditableSelectRow
                                    label="Client"
                                    value={ticket.client}
                                    placeholder="Select client"
                                    options={clients.options}
                                    saving={savingField === "client"}
                                    onSave={(v) => patchTicket({ client: v as any }, "client")}
                                />

                                <EditableSelectRow
                                    label="Site"
                                    value={ticket.site}
                                    placeholder="Select site"
                                    options={sites.options}
                                    saving={savingField === "site"}
                                    onSave={(v) => patchTicket({ site: v as any }, "site")}
                                />

                                <EditableSelectRow
                                    label="Device"
                                    value={ticket.deviceId ?? ""}
                                    placeholder="Select device"
                                    options={devices.options}
                                    saving={savingField === "deviceId"}
                                    onSave={(v) => patchTicket({ deviceId: v as any }, "deviceId")}
                                />

                                <InlineDateRow
                                    label="Due date"
                                    value={ticket.dueAt}
                                    onSave={(v) => patchTicket({ dueAt: v as any }, "dueAt")}
                                    saving={savingField === "dueAt"}
                                />

                                <MetaRow label="Updated">{fmtWhen(ticket.updatedAt)}</MetaRow>
                                <MetaRow label="Created">{fmtWhen(ticket.createdAt)}</MetaRow>
                            </dl>
                        </SectionCard>

                        <SectionCard>
                            <h3 className="mb-3 text-base font-semibold text-white">Linked tickets</h3>
                            <ul className="space-y-2 text-sm">
                                {extras.linked.map((lt) => (
                                    <li key={lt.id} className="flex items-center justify-between gap-2">
                                        <Link href={`/tickets/${lt.id}`} className="underline underline-offset-2 hover:opacity-80">
                                            {lt.number ?? shortId(lt.id)} — {lt.title}
                                        </Link>
                                        <StatusPill value={lt.status} />
                                    </li>
                                ))}
                                {extras.linked.length === 0 && <li className="text-gray-400">No linked tickets.</li>}
                            </ul>

                            <div className="mt-2">
                                <SmallBtn className={cn(btnBase, btnSecondary)} onClick={() => setLinkModalOpen(true)}>
                                    + Link a ticket
                                </SmallBtn>
                            </div>

                            <TicketLinkModal
                                open={linkModalOpen}
                                onOpenChange={setLinkModalOpen}
                                currentTicketId={id}
                                onLinked={() => extras.refetch()}
                                btnBase={btnBase}
                                btnSecondary={btnSecondary}
                            />
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
                                {extras.history.length === 0 && <li className="text-gray-400">No history entries.</li>}
                            </ul>
                        </SectionCard>

                        <SectionCard>
                            <h3 className="mb-2 text-base font-semibold text-white">Time worked</h3>
                            <div className="text-sm text-gray-300 tabular-nums">{formatHHMMSS(timer.seconds)}</div>
                            {isClosed && (
                                <div className="mt-2 text-xs text-amber-300">
                                    Ticket is closed. Replies/notes are disabled.
                                </div>
                            )}
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

function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
    return (
        <button
            {...props}
            className={cn("inline-flex h-8 items-center rounded-md px-2 text-xs transition-colors", props.className)}
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
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
            d.getMinutes()
        )}`;
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
                        <button className="font-medium text-gray-200 hover:underline underline-offset-2" onClick={() => setEditing(true)}>
                            {fmtWhen(value)}
                        </button>
                    ) : (
                        <button
                            className="text-xs rounded-md border border-zinc-700 px-2 py-1 text-gray-300 hover:bg-zinc-800/70"
                            onClick={() => setEditing(true)}
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
    ticketStatus,
    canned,
    onSent,
    btnBase,
    btnPrimary,
    btnSecondary,
    timeWorkedSeconds,
}: {
    ticketId: string;
    ticketStatus: string;
    canned: CannedResponse[];
    onSent: () => void;
    btnBase: string;
    btnPrimary: string;
    btnSecondary: string;
    timeWorkedSeconds: number;
}) {
    const [mode, setMode] = React.useState<"reply" | "note">("reply");
    const [body, setBody] = React.useState("");
    const [attach, setAttach] = React.useState<File[]>([]);
    const [dontEmailCustomer, setDontEmailCustomer] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);

    const isClosed = ticketStatus === "closed";

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
        if (isClosed) return;
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
                    timeWorkedSeconds,
                    attachments: files,
                    notifyCustomer: kind === "reply" && !dontEmailCustomer,
                    submitAs,
                }),
            });
            if (!res.ok) throw new Error(`Submit failed (${res.status})`);

            setBody("");
            setAttach([]);
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
                    <button
                        type="button"
                        className={cn(
                            "rounded-md border border-zinc-700 px-3 py-1",
                            mode === "reply" ? "bg-zinc-800 text-gray-200" : "bg-zinc-900 text-gray-400 hover:bg-zinc-800/50"
                        )}
                        onClick={() => setMode("reply")}
                        disabled={isClosed}
                    >
                        Reply
                    </button>
                    <button
                        type="button"
                        className={cn(
                            "rounded-md border border-zinc-700 px-3 py-1",
                            mode === "note" ? "bg-zinc-800 text-amber-200" : "bg-zinc-900 text-gray-400 hover:bg-zinc-800/50"
                        )}
                        onClick={() => setMode("note")}
                        disabled={isClosed}
                        title="Internal note (technicians only)"
                    >
                        Internal note
                    </button>
                </div>

                <div className="text-xs text-gray-400">
                    Time worked: <span className="tabular-nums">{formatHHMMSS(timeWorkedSeconds)}</span>
                </div>
            </div>

            {isClosed && (
                <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-900/10 p-2 text-sm text-amber-200">
                    This ticket is closed. You can’t add replies or internal notes.
                </div>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                    className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-gray-200"
                    onChange={(e) => pickCanned(e.currentTarget.value)}
                    defaultValue=""
                    title="Canned responses"
                    disabled={isClosed}
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

                <label className={cn("ml-auto inline-flex cursor-pointer items-center gap-2 text-sm", isClosed && "opacity-50 cursor-not-allowed")}>
                    <input
                        type="file"
                        multiple
                        className="hidden"
                        disabled={isClosed}
                        onChange={(e) => setAttach(Array.from(e.currentTarget.files ?? []))}
                    />
                    <span className="rounded-md border border-zinc-700 px-3 py-1 text-gray-200 hover:bg-zinc-800/70">
                        Add file
                    </span>
                    {attach.length > 0 && <span className="text-xs text-gray-400">{attach.length} file(s)</span>}
                </label>
            </div>

            <textarea
                className="min-h-[160px] w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
                placeholder={mode === "note" ? "Type an internal note (technicians only)…" : "Type your reply…"}
                value={body}
                onChange={(e) => setBody(e.currentTarget.value)}
                disabled={isClosed}
            />

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                    {mode === "reply" && (
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={dontEmailCustomer}
                                onChange={(e) => setDontEmailCustomer(e.currentTarget.checked)}
                                disabled={isClosed}
                            />
                            Don’t send email notification of this reply to the customer
                        </label>
                    )}
                    {mode === "note" && (
                        <div className="text-xs text-amber-200/90">
                            Internal notes are visible to technicians only.
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    {mode === "note" ? (
                        <button
                            className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                            disabled={submitting || isClosed}
                            onClick={() => submit("note")}
                        >
                            Add internal note
                        </button>
                    ) : (
                        <>
                            <button
                                className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                                disabled={submitting || isClosed}
                                onClick={() => submit("reply")}
                            >
                                Submit reply
                            </button>
                            <button
                                className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")}
                                disabled={submitting || isClosed}
                                onClick={() => submit("reply", "reply_and_resolve")}
                            >
                                Submit & Resolve
                            </button>
                            <button
                                className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")}
                                disabled={submitting || isClosed}
                                onClick={() => submit("reply", "reply_and_close")}
                            >
                                Submit & Close
                            </button>
                        </>
                    )}
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
