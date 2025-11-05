"use client";

import * as React from "react";

type Customer = { key: string; name: string; counts?: Record<string, number> };
type Site = { key: string; name: string; counts?: Record<string, number> };

const API_BASE =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "";

function u(path: string) {
    return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function useCustomers(q: string = "") {
    const [items, setItems] = React.useState<Customer[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<Error | null>(null);

    const fetcher = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const url = q ? u(`/api/customers?q=${encodeURIComponent(q)}`) : u("/api/customers");
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) throw new Error(`Customers HTTP ${res.status}`);
            const data = (await res.json()) as Customer[];
            setItems(data);
        } catch (e: any) {
            setError(e);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [q]);

    React.useEffect(() => { void fetcher(); }, [fetcher]);

    return { items, loading, error, refetch: fetcher };
}

export function useSites(clientName: string | null) {
    const [items, setItems] = React.useState<Site[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<Error | null>(null);

    React.useEffect(() => {
        if (!clientName) { setItems([]); return; }
        let active = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(u(`/api/customers/${encodeURIComponent(clientName)}/sites`), {
                    credentials: "include",
                });
                if (!res.ok) throw new Error(`Sites HTTP ${res.status}`);
                const data = (await res.json()) as Site[];
                if (active) setItems(data);
            } catch (e: any) {
                if (active) { setError(e); setItems([]); }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [clientName]);

    return { items, loading, error };
}
