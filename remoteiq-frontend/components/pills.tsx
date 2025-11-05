// components/pills.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Ticket status values we support visually. */
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
/** Priority values we support visually. */
export type TicketPriority = "low" | "normal" | "high" | "urgent";

/** Base “pill” styles */
const pillBase =
    "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

/** Status → color classes (good in light + dark) */
const STATUS_STYLES: Record<TicketStatus, string> = {
    open: "bg-emerald-500/15 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300",
    pending: "bg-blue-500/15    text-blue-700    ring-blue-600/20    dark:text-blue-300",
    resolved: "bg-amber-500/15   text-amber-700   ring-amber-600/20   dark:text-amber-300",
    closed: "bg-zinc-500/15    text-zinc-700    ring-zinc-500/20    dark:text-zinc-300",
};

/** Priority → color classes (good in light + dark) */
const PRIORITY_STYLES: Record<TicketPriority, string> = {
    low: "bg-zinc-500/15   text-zinc-700   ring-zinc-500/20   dark:text-zinc-300",
    normal: "bg-blue-500/15   text-blue-700   ring-blue-600/20   dark:text-blue-300",
    high: "bg-red-500/15    text-red-700    ring-red-600/20    dark:text-red-300",
    urgent: "bg-red-600/20    text-red-800    ring-red-700/25    dark:text-red-300",
};

function title(s: string) {
    return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/** Status pill */
export function StatusPill({
    value,
    className,
}: {
    value?: string | null;
    className?: string;
}) {
    const raw = (value ?? "").toString().trim();
    const norm = raw.toLowerCase() as TicketStatus;
    const known = (["open", "pending", "resolved", "closed"] as const).includes(norm);
    const color = known
        ? STATUS_STYLES[norm]
        : "bg-zinc-500/10 text-foreground ring-zinc-300/30 dark:text-zinc-300";
    const label = known ? title(norm) : raw || "—";
    return (
        <span className={cn(pillBase, color, className)} aria-label={`Status: ${label}`}>
            {label}
        </span>
    );
}

/** Priority pill */
export function PriorityPill({
    value,
    className,
}: {
    value?: string | null;
    className?: string;
}) {
    const raw = (value ?? "").toString().trim();
    const norm = raw.toLowerCase() as TicketPriority;
    const known = (["low", "normal", "high", "urgent"] as const).includes(norm);
    const color = known
        ? PRIORITY_STYLES[norm]
        : "bg-zinc-500/10 text-foreground ring-zinc-300/30 dark:text-zinc-300";
    const label = known ? title(norm) : raw || "—";
    return (
        <span className={cn(pillBase, color, className)} aria-label={`Priority: ${label}`}>
            {label}
        </span>
    );
}
