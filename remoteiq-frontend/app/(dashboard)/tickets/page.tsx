"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import TicketsTable, { Ticket } from "@/components/tickets-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const API = process.env.NEXT_PUBLIC_API_BASE || "";

function normalizeTicketsPayload(payload: any): Ticket[] {
  if (Array.isArray(payload)) return payload as Ticket[];
  if (payload && Array.isArray(payload.items)) return payload.items as Ticket[];
  return [];
}

export default function TicketsPage() {
  const router = useRouter();
  const [all, setAll] = React.useState<Ticket[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [q, setQ] = React.useState("");

  // Modals
  const [newOpen, setNewOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);

  // New ticket form
  const [ntTitle, setNtTitle] = React.useState("");
  const [ntDesc, setNtDesc] = React.useState("");
  const [ntBusy, setNtBusy] = React.useState(false);

  React.useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API}/api/tickets`, { credentials: "include" });
        const raw = res.ok ? await res.json() : [];
        const data = normalizeTicketsPayload(raw);
        if (!cancel) setAll(data);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;

    return all.filter((t: any) => {
      const idPrefix = String(t?.id ?? "").slice(0, 8).toLowerCase();
      const num = String(t?.number ?? t?.ticketNumber ?? "").toLowerCase();
      const title = String(t?.title ?? "").toLowerCase();
      const status = String(t?.status ?? "").toLowerCase();
      const priority = String(t?.priority ?? "").toLowerCase();

      return (
        idPrefix.includes(needle) ||
        num.includes(needle) ||
        title.includes(needle) ||
        status.includes(needle) ||
        priority.includes(needle)
      );
    });
  }, [all, q]);

  const btnBase =
    "font-semibold rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 inline-flex items-center justify-center ring-offset-white dark:ring-offset-zinc-950";
  const btnPrimary =
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 focus:ring-[hsl(var(--primary))]";
  const btnSecondary =
    "bg-zinc-100 hover:bg-zinc-200 text-zinc-900 focus:ring-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-gray-200 dark:focus:ring-zinc-500";

  async function handleCreateTicket() {
    if (!ntTitle.trim()) return;
    try {
      setNtBusy(true);
      const res = await fetch(`${API}/api/tickets`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: ntTitle.trim(), description: ntDesc }),
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      const created = await res.json();
      setNewOpen(false);
      setNtTitle("");
      setNtDesc("");
      if (created?.id) router.push(`/tickets/${created.id}`);
      else router.refresh();
    } catch (e) {
      alert((e as any)?.message ?? String(e));
    } finally {
      setNtBusy(false);
    }
  }

  async function handleExport() {
    setExportOpen(false);
    const rows = filtered.map((t: any) => ({
      id: t.id,
      number: t.number ?? t.ticketNumber ?? t.id?.slice?.(0, 8),
      title: t.title,
      status: t.status,
      priority: t.priority ?? "",
      requester: t.requesterName ?? t.requesterEmail ?? "",
      updatedAt: t.updatedAt ?? "",
    }));
    const csv = [
      "id,number,title,status,priority,requester,updatedAt",
      ...rows.map((r) =>
        [r.id, r.number, r.title, r.status, r.priority, r.requester, r.updatedAt]
          .map((x) => `"${String(x).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tickets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-gray-200 p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Tickets</h1>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            className={cn(btnBase, btnSecondary, "px-4 py-1.5 text-sm")}
            onClick={() => setExportOpen(true)}
          >
            Export
          </button>
          <button
            className={cn(btnBase, btnPrimary, "px-4 py-1.5 text-sm")}
            onClick={() => setNewOpen(true)}
          >
            + New Ticket
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by UUID prefix, ticket #, title, status..."
          className="md:col-span-2"
        />
      </div>

      <div className="overflow-x-auto">
        <TicketsTable items={filtered} loading={loading} />
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>Enter a title and optional description.</DialogDescription>
          </DialogHeader>
          <Input value={ntTitle} onChange={(e) => setNtTitle(e.target.value)} placeholder="Ticket title" autoFocus />
          <Textarea
            value={ntDesc}
            onChange={(e) => setNtDesc(e.target.value)}
            placeholder="Description (optional)"
            className="min-h-[120px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button className={cn(btnPrimary)} disabled={ntBusy} onClick={handleCreateTicket}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export tickets</DialogTitle>
            <DialogDescription>Export the current list to CSV?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button className={cn(btnPrimary)} onClick={handleExport}>
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}