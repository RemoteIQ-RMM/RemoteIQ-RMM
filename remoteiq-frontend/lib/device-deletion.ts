// remoteiq-frontend/lib/device-deletion.ts

type Json = any;

async function api<T = Json>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Request failed (${res.status})`);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
}

export async function requestDeviceDeletion(deviceId: string) {
    const id = String(deviceId ?? "").trim();
    if (!id) throw new Error("deviceId is required");
    return api(`/api/devices/${encodeURIComponent(id)}/deletion-requests`, { method: "POST" });
}

export async function approveDeviceDeletion(deviceId: string) {
    const id = String(deviceId ?? "").trim();
    if (!id) throw new Error("deviceId is required");
    return api(`/api/devices/${encodeURIComponent(id)}/deletion-requests/approve`, { method: "POST" });
}
