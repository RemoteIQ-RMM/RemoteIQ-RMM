// remoteiq-frontend/lib/tickets-api.ts
import { jfetch } from "./api";

export type TicketAttachment = {
    id: string;
    name: string;
    size?: number;
    url: string;
};

export type TicketReply = {
    id: string;
    kind: "message";
    author: string;
    body: string;
    createdAt: string;
    isInternal?: boolean; // should be false for replies; kept for back-compat
    attachments?: TicketAttachment[];
};

export type TicketInternalNote = {
    id: string;
    kind: "note";
    author: string;
    body: string;
    createdAt: string;
    isInternal?: boolean; // should be true for notes; kept for back-compat
    attachments?: TicketAttachment[];
};

export type TicketHistoryEntry = {
    at: string;
    who: string;
    what: string;
};

export async function fetchTicketReplies(ticketId: string): Promise<TicketReply[]> {
    return await jfetch<TicketReply[]>(`/api/tickets/${encodeURIComponent(ticketId)}/replies`);
}

/**
 * Internal notes are permission-gated (backend: RequirePerm("tickets.write")).
 * If the caller doesn't have access, jfetch will throw with err.status = 403.
 */
export async function fetchTicketInternalNotes(ticketId: string): Promise<TicketInternalNote[]> {
    return await jfetch<TicketInternalNote[]>(`/api/tickets/${encodeURIComponent(ticketId)}/notes`);
}

export async function fetchTicketHistory(ticketId: string): Promise<TicketHistoryEntry[]> {
    return await jfetch<TicketHistoryEntry[]>(`/api/tickets/${encodeURIComponent(ticketId)}/history`);
}

/**
 * Back-compat helper: if any old UI is still calling "activity",
 * backend now returns replies only.
 */
export async function fetchTicketActivityBackCompat(ticketId: string): Promise<TicketReply[]> {
    return await jfetch<TicketReply[]>(`/api/tickets/${encodeURIComponent(ticketId)}/activity`);
}
