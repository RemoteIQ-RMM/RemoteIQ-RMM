// lib/time.ts
// US-style: MM/DD/YYYY - H:MM AM/PM (local time)

const usFmt = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
});

function isBlankish(s: string) {
    const v = s.trim().toLowerCase();
    return (
        v === "" ||
        v === "—" ||
        v === "null" ||
        v === "undefined" ||
        v === "nan" ||
        v === "infinity" ||
        v === "+infinity" ||
        v === "-infinity"
    );
}

function parseDateSafe(input?: string | null): Date | null {
    if (input == null) return null;

    const raw = String(input);
    if (isBlankish(raw)) return null;

    const d = new Date(raw);
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;

    return d;
}

export function formatUsDateTime(iso?: string | null): string {
    const d = parseDateSafe(iso);
    if (!d) return "—";

    try {
        // Replace the comma Intl adds with " -"
        return usFmt.format(d).replace(",", " -");
    } catch {
        return "—";
    }
}

/**
 * Useful for <time dateTime="..."> attributes.
 * Returns a valid ISO string or null.
 */
export function toIsoStringSafe(iso?: string | null): string | null {
    const d = parseDateSafe(iso);
    if (!d) return null;

    try {
        return d.toISOString();
    } catch {
        return null;
    }
}
