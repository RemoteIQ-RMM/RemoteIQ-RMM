// lib/use-tickets.ts
"use client";

import * as React from "react";
import { jfetch } from "@/lib/api";
import type { Ticket } from "@/components/tickets-table";

type Query = {
  customerId?: string;
};

type TicketsResponse = {
  items: Ticket[];
  nextCursor?: string | null;
};

export function useTickets(query: Query = {}) {
  const [items, setItems] = React.useState<Ticket[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<Error | null>(null);

  const fetchTickets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.customerId) params.set("customerId", String(query.customerId));
      const res = await jfetch<TicketsResponse>(`/api/tickets${params.toString() ? "?" + params.toString() : ""}`);
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query.customerId]);

  React.useEffect(() => { fetchTickets(); }, [fetchTickets]);

  return { items, loading, error, refetch: fetchTickets };
}
