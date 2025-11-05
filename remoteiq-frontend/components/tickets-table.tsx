// components/tickets-table.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { StatusPill, PriorityPill } from "@/components/pills";

export type Ticket = {
  id: string;
  number?: string | null;
  title: string;
  status: string;
  priority?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  assignedTo?: string | null;
  customerId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type Renderer = (value?: string | null) => React.ReactNode;

type TicketsTableProps =
  | {
    items: Ticket[];
    loading?: boolean;
    showCustomer?: boolean;
    renderStatus?: Renderer;
    renderPriority?: Renderer;
  }
  | {
    items: { items?: Ticket[] } | { data?: Ticket[] } | unknown;
    loading?: boolean;
    showCustomer?: boolean;
    renderStatus?: Renderer;
    renderPriority?: Renderer;
  };

/** Normalize whatever we get into a Ticket[] */
function toArray(input: any): Ticket[] {
  if (Array.isArray(input)) return input as Ticket[];
  if (input && typeof input === "object") {
    if (Array.isArray((input as any).items)) return (input as any).items as Ticket[];
    if (Array.isArray((input as any).data)) return (input as any).data as Ticket[];
  }
  return [];
}

export default function TicketsTable(props: TicketsTableProps) {
  const { loading, showCustomer, renderStatus, renderPriority } = props as any;
  const list = React.useMemo(() => toArray((props as any).items), [props]);

  const [page, setPage] = React.useState(0);
  const RESULTS_PER_PAGE = 10;
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
  const start = page * RESULTS_PER_PAGE;
  const end = Math.min(total, (page + 1) * RESULTS_PER_PAGE);
  const visible = list.slice(start, end);

  const renderStatusPill: Renderer =
    renderStatus ??
    ((value?: string | null) => <StatusPill value={value?.toString()} />);

  const renderPriorityPill: Renderer =
    renderPriority ??
    ((value?: string | null) => <PriorityPill value={value?.toString()} />);

  React.useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  return (
    <div className="bg-zinc-900 dark:bg-zinc-900 border border-zinc-700/50 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-700/50">
          <thead className="bg-zinc-800/60">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">#</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Title</th>
              {showCustomer && (
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Customer
                </th>
              )}
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Priority</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Requester</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Assignee</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800/80">
            {visible.map((t: Ticket) => (
              <tr key={t.id} className="hover:bg-zinc-800/40 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-pink-500">
                  {t.number ?? t.id.slice(0, 8)}
                </td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-200">
                  <Link href={`/tickets/${t.id}`} className="hover:underline">
                    {t.title}
                  </Link>
                </td>

                {showCustomer && (
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">{t.customerId ?? "-"}</td>
                )}

                <td className="px-4 py-3 whitespace-nowrap text-sm">{renderStatusPill(t.status)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">{renderPriorityPill(t.priority)}</td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">
                  {t.requesterName ?? t.requesterEmail ?? "-"}
                </td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">{t.assignedTo ?? "-"}</td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">
                  {t.updatedAt ? safeWhen(t.updatedAt) : "-"}
                </td>
              </tr>
            ))}

            {!loading && total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-gray-400" colSpan={showCustomer ? 8 : 7}>
                  No tickets found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer / pagination */}
      <div className="bg-zinc-800/60 px-4 py-2.5 flex items-center justify-between border-t border-zinc-700/50">
        <span className="text-xs text-gray-400">
          {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 text-xs font-semibold rounded-md bg-transparent hover:bg-zinc-700/70 text-gray-300 disabled:opacity-50"
          >
            &lt; Prev
          </button>
          <span className="text-xs text-gray-400">
            Page {Math.min(page + 1, pageCount)} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="px-2 py-1 text-xs font-semibold rounded-md bg-transparent hover:bg-zinc-700/70 text-gray-300 disabled:opacity-50"
          >
            Next &gt;
          </button>
        </div>
      </div>
    </div>
  );
}

function safeWhen(iso: string) {
  const d = new Date(iso);
  return isFinite(d.getTime()) ? d.toLocaleString() : "-";
}
