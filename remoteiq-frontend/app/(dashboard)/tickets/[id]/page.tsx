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

    ticketNumber?: number | null;
    number?: string | null;

    title: string;
    description?: string | null;

    status: "open" | "resolved" | "closed" | "in_progress" | string;
    priority?: "low" | "normal" | "medium" | "high" | "urgent" | string | null;

    requesterName?: string | null;
    requesterEmail?: string | null;

    assignedTo?: string | null;
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

type Attachment = { id: string; name: string; size?: number; url: string };

type ActivityMessageOrNote = {
    id: string;
    kind: "message" | "note";
    author: string;
    body: string;
    createdAt: string;
    isInternal?: boolean;
    // some backends send snake_case
    is_internal?: boolean;
    attachments?: Attachment[];
};

type ActivityChange = {
    id: string;
    kind: "change";
    createdAt: string;
    actor: string;
    field: "status" | "priority" | "assignee" | "title" | "dueAt" | "collaborators";
    from?: string | null;
    to?: string | null;
};

type ActivityItem = ActivityMessageOrNote | ActivityChange;

type CannedResponse = { id: string; title: string; body: string };
type LinkedTicket = { id: string; number?: string | null; title: string; status: string };
type HistoryItem = { at: string; who: string; what: string };

type SearchTicket = {
    id: string;
    title: string;
    status: string;
    ticketNumber?: number | null;
    number?: string | null;
};

/* ----------------------------- Helpers --------------------------------- */

const API = process.env.NEXT_PUBLIC_API_BASE || "";

const shortId = (s: string) => String(s || "").slice(0, 8);
const fmtWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");

function getDisplayTicketNumber(t: Ticket): string {
    const tn = (t as any)?.ticketNumber;
    if (typeof tn === "number" && Number.isFinite(tn)) return String(tn);
    const n = t.number;
    if (typeof n === "string" && n.trim()) return n.trim();
    return shortId(t.id);
}

function SectionCard(props: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            {...props}
            className={cn("rounded-lg border border-zinc-700/50 bg-zinc-900 p-4", props.className)}
        />
    );
}

function safeText(v: unknown) {
    return typeof v === "string" ? v : "";
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

function getIsInternal(a: any): boolean {
    return !!(a?.isInternal ?? a?.is_internal ?? a?.internal);
}

function formatHHMMSS(totalSeconds: number) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ----------------------- Persistent Ticket Timer ------------------------ */

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
                // ignore
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
            start();
        };

        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("beforeunload", pause);

        const t = window.setInterval(() => persist(), 5000);

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

    return { seconds, persist };
}

/* ----------------------------- Data hooks ------------------------------ */

function useTicket(id: string) {
    const [ticket, setTicket] = React.useState<Ticket | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const ticketRef = React.useRef<Ticket | null>(null);
    React.useEffect(() => {
        ticketRef.current = ticket;
    }, [ticket]);

    const fetchTicket = React.useCallback(
        async (opts?: { silent?: boolean }) => {
            const silent = !!opts?.silent;
            const isInitial = ticketRef.current == null;

            try {
                if (isInitial) setLoading(true);
                else if (!silent) setRefreshing(true);

                setError(null);

                const res = await fetch(`${API}/api/tickets/${id}`, { credentials: "include", cache: "no-store" });
                if (!res.ok) throw new Error(`Failed to load ticket (${res.status})`);
                const data: Ticket = await res.json();
                setTicket(data);
            } catch (e: any) {
                setError(e?.message ?? String(e));
            } finally {
                if (isInitial) setLoading(false);
                setRefreshing(false);
            }
        },
        [id]
    );

    React.useEffect(() => {
        fetchTicket();
    }, [fetchTicket]);

    return { ticket, setTicket, loading, refreshing, error, refetch: fetchTicket };
}

function useTicketExtras(id: string) {
    const [activity, setActivity] = React.useState<ActivityItem[]>([]);
    const [canned, setCanned] = React.useState<CannedResponse[]>([]);
    const [linked, setLinked] = React.useState<LinkedTicket[]>([]);
    const [history, setHistory] = React.useState<HistoryItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);

    const hasLoadedRef = React.useRef(false);
    const seqRef = React.useRef(0);
    const abortRef = React.useRef<AbortController | null>(null);

    const fetchExtras = React.useCallback(
        async (opts?: { silent?: boolean }) => {
            const silent = !!opts?.silent;
            const isInitial = !hasLoadedRef.current;

            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;

            const mySeq = ++seqRef.current;

            try {
                if (isInitial) setLoading(true);
                else if (!silent) setRefreshing(true);

                const [a, n, c, l, h] = await Promise.all([
                    fetch(`${API}/api/tickets/${id}/activity`, { credentials: "include", cache: "no-store", signal: ac.signal }),
                    fetch(`${API}/api/tickets/${id}/notes`, { credentials: "include", cache: "no-store", signal: ac.signal }),
                    fetch(`${API}/api/tickets/canned-responses`, { credentials: "include", cache: "no-store", signal: ac.signal }),
                    fetch(`${API}/api/tickets/${id}/linked`, { credentials: "include", cache: "no-store", signal: ac.signal }),
                    fetch(`${API}/api/tickets/${id}/history`, { credentials: "include", cache: "no-store", signal: ac.signal }),
                ]);

                if (ac.signal.aborted) return;
                if (mySeq !== seqRef.current) return;

                const combined: ActivityItem[] = [];

                if (a.ok) {
                    try {
                        combined.push(...((await a.json()) as ActivityItem[]));
                    } catch {
                        // ignore
                    }
                }

                if (n.ok) {
                    try {
                        combined.push(...((await n.json()) as ActivityItem[]));
                    } catch {
                        // ignore
                    }
                }

                if (combined.length > 0) {
                    const map = new Map<string, ActivityItem>();
                    for (const item of combined) map.set((item as any)?.id, item);
                    setActivity(Array.from(map.values()));
                }

                if (c.ok) setCanned((await c.json()) as CannedResponse[]);
                if (l.ok) setLinked((await l.json()) as LinkedTicket[]);
                if (h.ok) setHistory((await h.json()) as HistoryItem[]);

                hasLoadedRef.current = true;
            } catch (e: any) {
                if (e?.name === "AbortError") return;
            } finally {
                if (isInitial) setLoading(false);
                setRefreshing(false);
            }
        },
        [id]
    );

    React.useEffect(() => {
        fetchExtras();
        return () => abortRef.current?.abort();
    }, [fetchExtras]);

    return { activity, canned, linked, history, loading, refreshing, refetch: fetchExtras };
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
    const id = safeText(u?.id).trim();
    const label = safeText(u?.name || u?.fullName || u?.email || u?.username || id).trim();
    if (!id || !label) return null;
    return { value: id, label };
};

const clientMapper = (c: any): Option | null => {
    const label = safeText(c?.name || c?.title || c?.displayName || c?.company || c?.id).trim();
    if (!label) return null;
    return { value: label, label };
};

const siteMapper = (s: any): Option | null => {
    const label = safeText(s?.name || s?.title || s?.label || s?.id).trim();
    if (!label) return null;
    return { value: label, label };
};

const deviceMapper = (d: any): Option | null => {
    const id = safeText(d?.id).trim();
    const label = safeText(d?.hostname || d?.name || d?.title || id).trim();
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
                            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-gray-200"
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
                body: JSON.stringify({ linkedId: target.id }),
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
                        <div className="rounded-md border border-red-700/40 bg-red-900/10 p-2 text-sm text-red-300">{err}</div>
                    )}

                    <div className="max-h-[340px] overflow-auto rounded-md border border-zinc-800 [scrollbar-gutter:stable]">
                        {busy && <div className="p-3 text-sm text-gray-400">Searching…</div>}

                        {!busy && q.trim() && results.length === 0 && <div className="p-3 text-sm text-gray-400">No matches.</div>}

                        {!busy && results.length > 0 && (
                            <ul className="divide-y divide-zinc-800">
                                {results.map((t) => {
                                    const displayNum =
                                        t.ticketNumber !== null && t.ticketNumber !== undefined ? String(t.ticketNumber) : t.number ?? shortId(t.id);

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
                    <button type="button" className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")} onClick={() => onOpenChange(false)} disabled={busy}>
                        Close
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* -------------------------- Small presentational ------------------------- */

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

function ListPanel({
    title,
    count,
    badgeLabel,
    badgeClassName,
    items,
    emptyText,
    className,
}: {
    title: string;
    count: number;
    badgeLabel: string;
    badgeClassName: string;
    items: ActivityMessageOrNote[];
    emptyText: string;
    className?: string;
}) {
    return (
        <SectionCard className={cn("flex flex-col min-h-0 overflow-hidden", className)}>
            <div className="mb-3 flex items-center justify-between shrink-0">
                <h2 className="text-base font-semibold text-white">{title}</h2>
                <span className="text-xs text-gray-400">{count} item(s)</span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable]">
                <ol className="space-y-4">
                    {items.map((a) => (
                        <li key={a.id} className="text-sm">
                            <div className="flex items-start gap-3">
                                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", badgeClassName)}>
                                    {badgeLabel}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-gray-400">
                                        {fmtWhen(a.createdAt)} • {a.author}
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap break-words text-gray-200">{a.body}</div>

                                    {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                                        <ul className="mt-2 space-y-1">
                                            {a.attachments.map((f: Attachment) => (
                                                <li key={f.id}>
                                                    <a className="underline underline-offset-2 hover:opacity-80" href={f.url} target="_blank" rel="noreferrer">
                                                        {f.name}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}

                    {items.length === 0 && <li className="text-sm text-gray-400">{emptyText}</li>}
                </ol>
            </div>
        </SectionCard>
    );
}

function TicketHistoryPanel({ history, className }: { history: HistoryItem[]; className?: string }) {
    const sorted = React.useMemo(
        () => history.slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
        [history]
    );

    return (
        <SectionCard className={cn("flex flex-col min-h-0 overflow-hidden", className)}>
            <h3 className="mb-3 text-base font-semibold text-white shrink-0">Ticket History</h3>
            <div className="flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable]">
                <ul className="space-y-2 text-sm">
                    {sorted.map((h, i) => (
                        <li key={`${h.at}-${i}`}>
                            <div className="text-gray-400">{fmtWhen(h.at)}</div>
                            <div className="text-gray-200">
                                {h.what} — {h.who}
                            </div>
                        </li>
                    ))}
                    {sorted.length === 0 && <li className="text-gray-400">No history entries.</li>}
                </ul>
            </div>
        </SectionCard>
    );
}

/* -------------------------------- Page --------------------------------- */

export default function TicketDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const { ticket, setTicket, loading, refreshing, error, refetch } = useTicket(id);
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

    const isResolvedOrClosed = ticket?.status === "resolved" || ticket?.status === "closed";
    const isClosed = ticket?.status === "closed";

    const timerEnabled = !ticket || (ticket.status !== "resolved" && ticket.status !== "closed");
    const timer = usePersistentTicketTimer(id, timerEnabled);

    const replies = React.useMemo(() => {
        const items = extras.activity.filter((a): a is ActivityMessageOrNote => a.kind === "message" || a.kind === "note");
        return items
            .filter((a) => a.kind === "message" && !getIsInternal(a))
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [extras.activity]);

    const notes = React.useMemo(() => {
        const items = extras.activity.filter((a): a is ActivityMessageOrNote => a.kind === "message" || a.kind === "note");
        return items
            .filter((a) => a.kind === "note" || getIsInternal(a))
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [extras.activity]);

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

        if (!res.ok) {
            await refetch({ silent: false });
        }

        await extras.refetch({ silent: true });

        if (fieldName) setSavingField(null);
    }

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

    // Mobile tabs: one scrollable “section” at a time (no full-page scrollbars)
    const [mobileTab, setMobileTab] = React.useState<"replies" | "notes" | "history" | "details" | "linked">("replies");

    const mobileTabs: Array<{ key: typeof mobileTab; label: string }> = [
        { key: "replies", label: "Replies" },
        { key: "notes", label: "Internal Notes" },
        { key: "history", label: "History" },
        { key: "details", label: "Details" },
        { key: "linked", label: "Linked" },
    ];

    return (
        <div className="h-[100dvh] bg-zinc-950 text-gray-200 overflow-hidden flex flex-col p-4 sm:p-6">
            <header className="mb-4 sm:mb-5 flex items-center justify-between shrink-0 gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-400 min-w-0">
                    <Link href="/tickets" className="hover:underline underline-offset-2 shrink-0">
                        Tickets
                    </Link>
                    <span className="shrink-0">/</span>
                    <span className="truncate text-gray-200">{ticket?.title ?? shortId(id)}</span>
                    {refreshing ? <span className="text-xs text-gray-500 shrink-0">(refreshing)</span> : null}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        className={cn(btnBase, btnSecondary, "px-3 sm:px-4 py-1.5 text-sm")}
                        onClick={() => {
                            refetch({ silent: false });
                            extras.refetch({ silent: false });
                        }}
                        title="Refresh"
                    >
                        Refresh
                    </button>
                    <button
                        className={cn(btnBase, btnPrimary, "px-3 sm:px-4 py-1.5 text-sm")}
                        onClick={() => router.push("/tickets")}
                    >
                        Back
                    </button>
                </div>
            </header>

            <div className="flex-1 min-h-0 overflow-hidden">
                {loading && <SectionCard className="text-sm text-gray-300">Loading…</SectionCard>}

                {error && <SectionCard className="text-sm border-red-700/30 bg-red-900/10 text-red-300">{error}</SectionCard>}

                {ticket && (
                    <>
                        {/* ============================ DESKTOP (lg+) ============================ */}
                        <div className="hidden lg:grid gap-6 lg:grid-cols-3 h-full min-h-0 overflow-hidden">
                            {/* Main column */}
                            <div className="lg:col-span-2 h-full min-h-0 flex flex-col gap-6 overflow-hidden">
                                <SectionCard className="shrink-0">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h1 className="text-xl font-semibold text-white">{ticket.title}</h1>
                                            <div className="mt-2 flex items-center gap-2">
                                                <StatusPill value={ticket.status} />
                                                <PriorityPill value={ticket.priority} />
                                                <span className="text-xs text-gray-400"># {getDisplayTicketNumber(ticket)}</span>
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
                                                <button className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")} onClick={reopen}>
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
                                        extras.refetch({ silent: true });
                                        refetch({ silent: true });
                                    }}
                                    onStatusChange={(next) => setTicket((t) => (t ? { ...t, status: next as any } : t))}
                                    btnBase={btnBase}
                                    btnPrimary={btnPrimary}
                                    btnSecondary={btnSecondary}
                                    timeWorkedSeconds={timer.seconds}
                                />

                                <div className="grid gap-6 lg:grid-cols-2 flex-1 min-h-0 overflow-hidden">
                                    <ListPanel
                                        title="Replies"
                                        count={replies.length}
                                        badgeLabel="Reply"
                                        badgeClassName="bg-blue-500/15 text-blue-300"
                                        items={replies}
                                        emptyText={extras.loading ? "Loading…" : "No replies yet."}
                                    />

                                    <ListPanel
                                        title="Internal Notes"
                                        count={notes.length}
                                        badgeLabel="Note"
                                        badgeClassName="bg-amber-500/15 text-amber-300"
                                        items={notes}
                                        emptyText={extras.loading ? "Loading…" : "No internal notes yet."}
                                    />
                                </div>
                            </div>

                            {/* Sidebar */}
                            <div className="h-full min-h-0 flex flex-col gap-6 overflow-hidden">
                                <SectionCard className="shrink-0">
                                    <h3 className="mb-3 text-base font-semibold text-white">Ticket Details</h3>

                                    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 sm:gap-x-8">
                                        <div className="space-y-3">
                                            <MetaRow label="Ticket #">{getDisplayTicketNumber(ticket)}</MetaRow>
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
                                        </div>

                                        <div className="space-y-3">
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
                                        </div>
                                    </dl>
                                </SectionCard>

                                <SectionCard className="shrink-0">
                                    <h3 className="mb-3 text-base font-semibold text-white">Linked tickets</h3>

                                    <div className="max-h-[220px] overflow-auto pr-2 [scrollbar-gutter:stable]">
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
                                    </div>

                                    <div className="mt-2">
                                        <SmallBtn className={cn(btnBase, btnSecondary)} onClick={() => setLinkModalOpen(true)}>
                                            + Link a ticket
                                        </SmallBtn>
                                    </div>

                                    <TicketLinkModal
                                        open={linkModalOpen}
                                        onOpenChange={setLinkModalOpen}
                                        currentTicketId={id}
                                        onLinked={() => extras.refetch({ silent: true })}
                                        btnBase={btnBase}
                                        btnSecondary={btnSecondary}
                                    />
                                </SectionCard>

                                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                                    <TicketHistoryPanel history={extras.history} className="flex-1" />
                                </div>

                                <SectionCard className="shrink-0">
                                    <h3 className="mb-2 text-base font-semibold text-white">Time worked</h3>
                                    <div className="text-sm text-gray-300 tabular-nums">{formatHHMMSS(timer.seconds)}</div>
                                    {isClosed && <div className="mt-2 text-xs text-amber-300">Ticket is closed. Replies/notes are disabled.</div>}
                                </SectionCard>
                            </div>
                        </div>

                        {/* ============================ MOBILE / TABLET (<lg) ============================ */}
                        <div className="lg:hidden h-full min-h-0 flex flex-col gap-4 overflow-hidden">
                            {/* Summary + actions (scrolls internally on mobile) */}
                            <SectionCard className="shrink-0 flex flex-col min-h-0 overflow-hidden max-h-[32dvh]">
                                <div className="flex items-start justify-between gap-3 shrink-0">
                                    <div className="min-w-0">
                                        <h1 className="text-lg font-semibold text-white truncate">{ticket.title}</h1>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <StatusPill value={ticket.status} />
                                            <PriorityPill value={ticket.priority} />
                                            <span className="text-xs text-gray-400"># {getDisplayTicketNumber(ticket)}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2 shrink-0">
                                        {ticket.status !== "resolved" && ticket.status !== "closed" ? (
                                            <>
                                                <button
                                                    className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")}
                                                    onClick={markResolved}
                                                    disabled={isResolvedOrClosed}
                                                >
                                                    Resolve
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
                                            <button className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm")} onClick={reopen}>
                                                Reopen
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {ticket.description ? (
                                    <div className="mt-3 flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable] text-sm text-gray-200 whitespace-pre-wrap break-words">
                                        {ticket.description}
                                    </div>
                                ) : null}
                            </SectionCard>

                            {/* Composer (scrolls internally on mobile) */}
                            <Composer
                                ticketId={ticket.id}
                                ticketStatus={ticket.status}
                                canned={extras.canned}
                                onSent={() => {
                                    extras.refetch({ silent: true });
                                    refetch({ silent: true });
                                }}
                                onStatusChange={(next) => setTicket((t) => (t ? { ...t, status: next as any } : t))}
                                btnBase={btnBase}
                                btnPrimary={btnPrimary}
                                btnSecondary={btnSecondary}
                                timeWorkedSeconds={timer.seconds}
                            />

                            {/* Tabs */}
                            <div className="shrink-0 overflow-x-auto [scrollbar-gutter:stable]">
                                <div className="inline-flex gap-2 min-w-max">
                                    {mobileTabs.map((t) => (
                                        <button
                                            key={t.key}
                                            type="button"
                                            onClick={() => setMobileTab(t.key)}
                                            className={cn(
                                                "h-9 px-3 text-sm rounded-md border border-zinc-700 transition-colors",
                                                mobileTab === t.key
                                                    ? "bg-zinc-800 text-gray-100"
                                                    : "bg-zinc-900 text-gray-300 hover:bg-zinc-800/60"
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* One panel at a time */}
                            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                                {mobileTab === "replies" && (
                                    <ListPanel
                                        title="Replies"
                                        count={replies.length}
                                        badgeLabel="Reply"
                                        badgeClassName="bg-blue-500/15 text-blue-300"
                                        items={replies}
                                        emptyText={extras.loading ? "Loading…" : "No replies yet."}
                                        className="flex-1"
                                    />
                                )}

                                {mobileTab === "notes" && (
                                    <ListPanel
                                        title="Internal Notes"
                                        count={notes.length}
                                        badgeLabel="Note"
                                        badgeClassName="bg-amber-500/15 text-amber-300"
                                        items={notes}
                                        emptyText={extras.loading ? "Loading…" : "No internal notes yet."}
                                        className="flex-1"
                                    />
                                )}

                                {mobileTab === "history" && <TicketHistoryPanel history={extras.history} className="flex-1" />}

                                {mobileTab === "details" && (
                                    <SectionCard className="flex flex-col min-h-0 overflow-hidden flex-1">
                                        <div className="mb-3 flex items-center justify-between shrink-0">
                                            <h3 className="text-base font-semibold text-white">Ticket Details</h3>
                                            <div className="text-xs text-gray-400 tabular-nums">{formatHHMMSS(timer.seconds)}</div>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable]">
                                            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 sm:gap-x-8">
                                                <div className="space-y-3">
                                                    <MetaRow label="Ticket #">{getDisplayTicketNumber(ticket)}</MetaRow>
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
                                                </div>

                                                <div className="space-y-3">
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
                                                </div>
                                            </dl>

                                            {isClosed && (
                                                <div className="mt-4 rounded-md border border-amber-700/40 bg-amber-900/10 p-2 text-sm text-amber-200">
                                                    Ticket is closed. Replies/notes are disabled.
                                                </div>
                                            )}
                                        </div>
                                    </SectionCard>
                                )}

                                {mobileTab === "linked" && (
                                    <SectionCard className="flex flex-col min-h-0 overflow-hidden flex-1">
                                        <div className="mb-3 flex items-center justify-between shrink-0">
                                            <h3 className="text-base font-semibold text-white">Linked tickets</h3>
                                            <SmallBtn className={cn(btnBase, btnSecondary)} onClick={() => setLinkModalOpen(true)}>
                                                + Link
                                            </SmallBtn>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable]">
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
                                        </div>

                                        <TicketLinkModal
                                            open={linkModalOpen}
                                            onOpenChange={setLinkModalOpen}
                                            currentTicketId={id}
                                            onLinked={() => extras.refetch({ silent: true })}
                                            btnBase={btnBase}
                                            btnSecondary={btnSecondary}
                                        />
                                    </SectionCard>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
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
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    onStatusChange,
    btnBase,
    btnPrimary,
    btnSecondary,
    timeWorkedSeconds,
}: {
    ticketId: string;
    ticketStatus: string;
    canned: CannedResponse[];
    onSent: () => void;
    onStatusChange?: (nextStatus: "open" | "in_progress" | "resolved" | "closed" | string) => void;
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

    async function pickCanned(id: string) {
        const match = canned.find((c) => c.id === id);
        if (!match) return;

        try {
            const res = await fetch(`${API}/api/tickets/${ticketId}/canned-render`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ template: match.body }),
            });

            if (!res.ok) {
                const msg = await safeReadErrorMessage(res);
                throw new Error(msg || `Render failed (${res.status})`);
            }

            const data = await res.json();
            const rendered = typeof data?.rendered === "string" ? data.rendered : match.body;

            setBody((b) => (b ? `${b}\n\n${rendered}` : rendered));
        } catch {
            setBody((b) => (b ? `${b}\n\n${match.body}` : match.body));
        }
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

    async function submit(kind: "reply" | "note", submitAs?: "reply" | "reply_and_close" | "reply_and_resolve") {
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

            if (submitAs === "reply_and_resolve") onStatusChange?.("resolved");
            if (submitAs === "reply_and_close") onStatusChange?.("closed");

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
        <SectionCard className="shrink-0 flex flex-col min-h-0 overflow-hidden max-h-[48dvh] lg:max-h-none">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
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
                <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-900/10 p-2 text-sm text-amber-200 shrink-0">
                    This ticket is closed. You can’t add replies or internal notes.
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto pr-2 [scrollbar-gutter:stable]">
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
                        <span className="rounded-md border border-zinc-700 px-3 py-1 text-gray-200 hover:bg-zinc-800/70">Add file</span>
                        {attach.length > 0 ? (
                            <span className="text-xs text-gray-400 tabular-nums">{attach.length} file(s)</span>
                        ) : (
                            <span className="text-xs text-gray-400 tabular-nums opacity-0">0 file(s)</span>
                        )}
                    </label>
                </div>

                <textarea
                    className="min-h-[130px] sm:min-h-[160px] w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
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
                        {mode === "note" && <div className="text-xs text-amber-200/90">Internal notes are visible to technicians only.</div>}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {mode === "note" ? (
                            <button
                                className={cn(btnBase, "h-9 px-3 text-sm disabled:opacity-50", "bg-zinc-700 hover:bg-zinc-600 text-gray-200")}
                                disabled={submitting || isClosed}
                                onClick={() => submit("note")}
                            >
                                Add internal note
                            </button>
                        ) : (
                            <>
                                <button className={cn(btnBase, btnSecondary, "h-9 px-3 text-sm disabled:opacity-50")} disabled={submitting || isClosed} onClick={() => submit("reply")}>
                                    Submit reply
                                </button>
                                <button className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")} disabled={submitting || isClosed} onClick={() => submit("reply", "reply_and_resolve")}>
                                    Submit & Resolve
                                </button>
                                <button className={cn(btnBase, btnPrimary, "h-9 px-3 text-sm disabled:opacity-50")} disabled={submitting || isClosed} onClick={() => submit("reply", "reply_and_close")}>
                                    Submit & Close
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </SectionCard>
    );
}