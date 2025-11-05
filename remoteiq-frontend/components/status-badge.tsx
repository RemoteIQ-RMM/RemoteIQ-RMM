// components/status-badge.tsx

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/app/(dashboard)/dashboard-context";

/** Normalize to lowercase for styling/logic. */
const norm = (s?: DeviceStatus | null) => {
    const v = (s ?? "offline").toString().toLowerCase();
    return (v === "healthy" || v === "warning" || v === "critical" || v === "offline"
        ? v
        : "offline") as "healthy" | "warning" | "critical" | "offline";
};

export function StatusBadge({ status }: { status?: DeviceStatus | null }) {
    const s = norm(status);
    const color =
        s === "healthy" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
            s === "warning" ? "bg-amber-500/15  text-amber-700  dark:text-amber-400" :
                s === "critical" ? "bg-red-500/15     text-red-600     dark:text-red-400" :
                    "bg-slate-500/15   text-slate-600   dark:text-slate-300"; // offline

    const label =
        s === "healthy" ? "Healthy" :
            s === "warning" ? "Warning" :
                s === "critical" ? "Critical" :
                    "Offline";

    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                color
            )}
            aria-label={`Status: ${label}`}
            title={label}
        >
            {label}
        </span>
    );
}
