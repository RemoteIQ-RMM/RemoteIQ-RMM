// app/(dashboard)/layout.tsx
"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import TopBar from "@/components/top-bar";
import Sidebar from "@/components/sidebar";

/**
 * Dashboard area shell
 * - Global TopBar (fixed 56px).
 * - Optional left Sidebar (only on /devices…; the /customers area renders its own sidebar).
 * - Main content scrolls independently.
 *
 * NOTE: DashboardProvider is already mounted at the app root (via app/providers.tsx),
 * so we intentionally do NOT wrap another provider here to avoid double contexts.
 *
 * POP-OUT MODE:
 * - If ?popout=1 is present, render ONLY the children (no TopBar, no Sidebar, no top padding).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const search = useSearchParams();
    const popout = String(search?.get("popout") ?? "").trim() === "1";

    if (popout) {
        return <div className="min-h-screen w-full">{children}</div>;
    }

    return (
        <div className="min-h-screen">
            <TopBar />
            <SidebarVisibility>{children}</SidebarVisibility>
        </div>
    );
}

/**
 * Shows the global Sidebar only on Devices pages.
 * - Dashboard ("/"): hide sidebar
 * - Customers ("/customers…"): hide (Customers has its own sidebar/layout)
 * - Devices ("/devices…"): show sidebar
 */
function SidebarVisibility({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const search = useSearchParams();
    const popout = String(search?.get("popout") ?? "").trim() === "1";

    // Extra safety: if popout is set, never render sidebar or top padding
    if (popout) {
        return <div className="w-full">{children}</div>;
    }

    const showSidebar = pathname?.startsWith("/devices");

    return (
        <div className="flex w-full" style={{ paddingTop: 56 /* TopBar height */ }}>
            {showSidebar && (
                <aside className="hidden md:block w-64 shrink-0 border-r bg-background">
                    <Sidebar />
                </aside>
            )}
            <section className="flex-1 min-w-0">{children}</section>
        </div>
    );
}
