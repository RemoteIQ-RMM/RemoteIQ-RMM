"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/top-bar";

// Flexible helper: honor NEXT_PUBLIC_API_BASE if set, otherwise same-origin
function getApiBase(): string {
    const raw = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!raw) return ""; // same-origin
    return raw.endsWith("/api") ? raw.slice(0, -4) : raw;
}

type RoleLike =
    | { permissions?: string[] | Record<string, boolean> }
    | Record<string, unknown>;

type MeUser = {
    id: string;
    email?: string;
    name?: string;
    role?: string;
    roles?: Array<{ id: string; name: string; permissions?: string[] | Record<string, boolean> }>;
    permissions?: string[] | Record<string, boolean>;
};

type MeResponse = { user: MeUser | null };

function toPermKeys(p?: string[] | Record<string, boolean>): string[] {
    if (!p) return [];
    if (Array.isArray(p)) return p;
    return Object.entries(p)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k);
}

function roleHasAdminAccess(role: RoleLike): boolean {
    const keys = toPermKeys((role as any)?.permissions);
    return keys.includes("admin.access");
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [loading, setLoading] = React.useState(true);
    const [allowed, setAllowed] = React.useState<boolean>(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const base = getApiBase();
                const res = await fetch(`${base}/api/auth/me`, { credentials: "include" });
                if (!res.ok) throw new Error(String(res.status));
                const data: MeResponse = await res.json();

                if (cancelled) return;

                // Not logged in → send to login with next=/administration
                if (!data.user) {
                    router.replace("/login?next=/administration");
                    return;
                }

                // Owners always allowed; otherwise require admin.access on user or any role
                const u = data.user;
                const userPerms = toPermKeys(u.permissions);
                const anyRoleHas = Array.isArray(u.roles) && u.roles.some((r) => roleHasAdminAccess(r));
                const isOwner = (u.role || "").toLowerCase() === "owner";
                const hasAdmin = isOwner || userPerms.includes("admin.access") || anyRoleHas;

                setAllowed(hasAdmin);
            } catch {
                // On error, punt back to login (token likely invalid)
                router.replace("/login?next=/administration");
                return;
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [router]);

    // Loading shimmer
    if (loading) {
        return (
            <>
                <TopBar />
                <div
                    className="bg-background h-[calc(100vh-3.5rem)] overflow-y-scroll"
                    style={{ scrollbarGutter: "stable both-edges" }}
                >
                    <div className="pt-14 flex items-center justify-center">
                        <div className="text-sm text-muted-foreground">Checking access…</div>
                    </div>
                </div>
            </>
        );
    }

    // Forbidden
    if (!allowed) {
        return (
            <>
                <TopBar />
                <div
                    className="bg-background h-[calc(100vh-3.5rem)] overflow-y-scroll"
                    style={{ scrollbarGutter: "stable both-edges" }}
                >
                    <div className="pt-14 max-w-2xl mx-auto px-4">
                        <div className="rounded-md border bg-card text-card-foreground p-6 mt-6">
                            <h2 className="text-lg font-semibold">403 — Not authorized</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                You don’t have permission to access the Administration area. Ask an administrator to grant the{" "}
                                <code className="px-1 rounded bg-muted">admin.access</code> permission to your user or role.
                            </p>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // Allowed → render the original shell + children
    return (
        <>
            <TopBar />
            <div
                className="bg-background h-[calc(100vh-3.5rem)] overflow-y-scroll"
                style={{ scrollbarGutter: "stable both-edges" }}
            >
                <div className="pt-14">{children}</div>
            </div>
        </>
    );
}
