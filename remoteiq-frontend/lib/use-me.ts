// lib/use-me.ts
"use client";

import * as React from "react";

export type MeUser = {
    id: string;
    email: string;
    name?: string | null;
    organizationId?: string | null;
    roles?: string[];
    role?: string | null;
    permissions?: string[];
};

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001").replace(
    /\/+$/,
    ""
);

type MeResponse = { user: MeUser | null } | MeUser | null;

let _cache: { user: MeUser | null; at: number } | null = null;
let _inFlight: Promise<MeUser | null> | null = null;

async function fetchMe(): Promise<MeUser | null> {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
    });

    if (!res.ok) {
        // if not authed, treat as null user
        return null;
    }

    const data: MeResponse = await res.json().catch(() => null);

    if (!data) return null;
    if ((data as any)?.user !== undefined) return (data as any).user ?? null;
    return data as any;
}

export function useMe() {
    const [user, setUser] = React.useState<MeUser | null>(() => _cache?.user ?? null);
    const [loading, setLoading] = React.useState<boolean>(() => !_cache);
    const [error, setError] = React.useState<string | null>(null);

    const refetch = React.useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const u = await fetchMe();
            _cache = { user: u, at: Date.now() };
            setUser(u);
            return u;
        } catch (e: any) {
            setError(String(e?.message ?? e) || "Failed to load user");
            setUser(null);
            _cache = { user: null, at: Date.now() };
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        let cancelled = false;

        // short cache window to avoid hammering /me across pages
        const fresh = _cache && Date.now() - _cache.at < 10_000;
        if (fresh) {
            setLoading(false);
            setUser(_cache!.user);
            return;
        }

        if (!_inFlight) {
            _inFlight = fetchMe()
                .then((u) => {
                    _cache = { user: u, at: Date.now() };
                    return u;
                })
                .finally(() => {
                    _inFlight = null;
                });
        }

        setLoading(true);
        _inFlight
            .then((u) => {
                if (cancelled) return;
                setUser(u);
            })
            .catch((e: any) => {
                if (cancelled) return;
                setError(String(e?.message ?? e) || "Failed to load user");
                setUser(null);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const permissions = user?.permissions ?? [];

    return { user, permissions, loading, error, refetch };
}
