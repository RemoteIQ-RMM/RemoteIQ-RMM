// remoteiq-frontend/lib/device-move.ts
// Small, self-contained helper to move a device to another site via API.
// - Uses credentials cookies (credentials: "include")
// - Tries a few endpoint variants
// - Emits a browser event on success so other parts of the UI can refetch if desired

export const DEVICES_CHANGED_EVENT = "remoteiq:devices-changed";

function emitDevicesChanged(detail?: any) {
    if (typeof window === "undefined") return;
    try {
        window.dispatchEvent(new CustomEvent(DEVICES_CHANGED_EVENT, { detail }));
    } catch {
        // ignore
    }
}

async function readErrorMessage(res: Response): Promise<string> {
    try {
        const data = await res.clone().json();
        const msg =
            typeof (data as any)?.message === "string"
                ? (data as any).message
                : JSON.stringify(data);
        return msg;
    } catch {
        try {
            return await res.text();
        } catch {
            return "";
        }
    }
}

async function tryMoveOnce(path: string, method: "PATCH" | "POST", body: any) {
    const res = await fetch(path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const msg = await readErrorMessage(res);
        const err = new Error(msg || `Request failed: ${res.status}`);
        (err as any).status = res.status;
        throw err;
    }

    if (res.status === 204) return undefined;

    try {
        return await res.json();
    } catch {
        return undefined;
    }
}

export async function moveDeviceToSite(deviceId: string, siteId: string): Promise<any> {
    const did = String(deviceId ?? "").trim();
    const sid = String(siteId ?? "").trim();
    if (!did) throw new Error("deviceId is required");
    if (!sid) throw new Error("siteId is required");

    const encDid = encodeURIComponent(did);

    const candidates: Array<{ path: string; method: "PATCH" | "POST"; body: any }> = [
        { path: `/api/devices/${encDid}/site`, method: "PATCH", body: { siteId: sid } },
        { path: `/api/devices/${encDid}/site`, method: "POST", body: { siteId: sid } },
        { path: `/api/devices/${encDid}/move-site`, method: "PATCH", body: { siteId: sid } },
        { path: `/api/devices/${encDid}/site/move`, method: "PATCH", body: { siteId: sid } },
    ];

    let lastErr: any = null;

    for (const c of candidates) {
        try {
            const updated = await tryMoveOnce(c.path, c.method, c.body);

            // Tell the rest of the app “device changed” (optional listeners can refetch)
            emitDevicesChanged({ deviceId: did, siteId: sid, updated });

            return updated;
        } catch (e: any) {
            const status = e?.status ?? e?.code;
            // unsupported endpoint → try next
            if (status === 404 || status === 405) continue;
            lastErr = e;
            break;
        }
    }

    if (lastErr) throw lastErr;
    throw new Error("No supported endpoint found to move device to site.");
}
