// remoteiq-frontend/lib/device-files-api.ts
// Thin client for the device file browser endpoints (job-based).
// Uses relative /api so Next rewrites can proxy to backend in dev.

export type JobRow = {
    id: string;
    type: string;
    status: string;
    payload?: any;
    stdout?: string | null;
    stderr?: string | null;
    parsed_stdout?: any | null;
};

export type FsItem = {
    name: string;
    path: string;
    isDir: boolean;
    size?: number | null;
    modifiedAt?: string | null;
};

export type DriveItem = { name: string; path: string };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const j = await res.json();
            msg = j?.message || j?.error || msg;
        } catch {
            // ignore
        }
        throw new Error(msg);
    }

    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
}

export async function getJob(jobId: string): Promise<JobRow> {
    return apiFetch<JobRow>(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
        },
    });
}

export async function waitForJob(
    jobId: string,
    opts?: { timeoutMs?: number; pollMs?: number }
): Promise<JobRow> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const pollMs = opts?.pollMs ?? 650;

    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const job = await getJob(jobId);
        const s = String(job.status || "").toLowerCase();
        if (s === "succeeded" || s === "failed" || s === "timeout") return job;

        if (Date.now() - start > timeoutMs) {
            throw new Error("Timed out waiting for job to finish");
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

type AgentJobResponse = { id: string };

// --------------------------- Core endpoints ---------------------------

export async function fileRoots(deviceId: string): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/roots`,
        { method: "GET" }
    );
}

export async function fileList(
    deviceId: string,
    path: string,
    recursive?: boolean
): Promise<AgentJobResponse> {
    const qs = new URLSearchParams({ path: String(path ?? "") });
    if (recursive) qs.set("recursive", "true");
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files?${qs.toString()}`,
        { method: "GET" }
    );
}

export async function fileRead(
    deviceId: string,
    path: string,
    maxBytes?: number
): Promise<AgentJobResponse> {
    const qs = new URLSearchParams({ path: String(path ?? "") });
    if (typeof maxBytes === "number") qs.set("maxBytes", String(maxBytes));
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/read?${qs.toString()}`,
        { method: "GET" }
    );
}

export async function fileWrite(
    deviceId: string,
    path: string,
    contentBase64: string
): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/write`,
        { method: "POST", body: JSON.stringify({ path, contentBase64 }) }
    );
}

export async function fileMkdir(deviceId: string, path: string): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/mkdir`,
        { method: "POST", body: JSON.stringify({ path }) }
    );
}

export async function fileDelete(
    deviceId: string,
    path: string,
    recursive?: boolean
): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/delete`,
        { method: "POST", body: JSON.stringify({ path, recursive: !!recursive }) }
    );
}

export async function fileMove(
    deviceId: string,
    from: string,
    to: string
): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/move`,
        { method: "POST", body: JSON.stringify({ from, to }) }
    );
}

export async function fileCopy(
    deviceId: string,
    from: string,
    to: string,
    recursive?: boolean
): Promise<AgentJobResponse> {
    return apiFetch<AgentJobResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/files/copy`,
        { method: "POST", body: JSON.stringify({ from, to, recursive: !!recursive }) }
    );
}

// --------------------------- High-level helpers ---------------------------

function tryParse(s: any): any | null {
    if (typeof s !== "string") return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function normalizeWindowsDriveRoot(p: string): string {
    const s = String(p ?? "").trim();
    // "C:" -> "C:\"
    if (/^[A-Za-z]:$/.test(s)) return `${s}\\`;
    // "C:\" ok
    if (/^[A-Za-z]:\\$/.test(s)) return s;
    return s;
}

function coerceItems(raw: any): FsItem[] {
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    return arr
        .map((x: any) => {
            const name = String(x?.name ?? x?.label ?? "");
            const pathRaw = String(x?.path ?? x?.fullPath ?? x?.full_path ?? "");
            const path = pathRaw ? normalizeWindowsDriveRoot(pathRaw) : "";

            const isDir = !!(x?.isDir ?? x?.is_dir ?? x?.dir);
            if (!name || !path) return null;

            const size =
                x?.size == null ? null : typeof x.size === "number" ? x.size : Number(x.size);

            const modifiedAt =
                x?.modifiedAt ?? x?.modified_at ?? x?.modifiedUtc ?? x?.mtime ?? x?.lastModified ?? null;

            return {
                name,
                path,
                isDir,
                size: Number.isFinite(size as any) ? (size as number) : null,
                modifiedAt: modifiedAt == null ? null : String(modifiedAt),
            } satisfies FsItem;
        })
        .filter(Boolean) as FsItem[];
}

/**
 * Roots (drives)
 *
 * Accepts any of:
 * - { drives:[{name,path|fullPath}] }
 * - { items:[{name,path|fullPath}] }
 * - { roots:[{name,path|fullPath}] }
 * - plain array [{name,path|fullPath}]
 */
export async function listDrives(deviceId: string): Promise<DriveItem[]> {
    const { id } = await fileRoots(deviceId);
    const job = await waitForJob(id, { timeoutMs: 60_000, pollMs: 700 });

    if (String(job.status || "").toLowerCase() !== "succeeded") {
        const msg = String(job.stderr || job.stdout || "Roots failed");
        throw new Error(msg);
    }

    const out = job.parsed_stdout ?? (job.stdout ? tryParse(job.stdout) : null);

    const drivesRaw =
        out?.drives ??
        out?.Drives ??
        out?.items ??
        out?.Items ??
        out?.roots ??
        out?.Roots ??
        out ??
        [];

    const arr = Array.isArray(drivesRaw) ? drivesRaw : [];

    const drives = arr
        .map((d: any) => {
            // Your agent uses: { name:"C:\\", fullPath:"C:" }
            const fullPath = String(
                d?.path ??
                d?.fullPath ??
                d?.full_path ??
                d?.root ??
                d?.mount ??
                d?.value ??
                d?.drive ??
                ""
            ).trim();

            if (!fullPath) return null;

            const path = normalizeWindowsDriveRoot(fullPath);

            // Derive a friendly name:
            // Prefer "C:" not "C:\"
            const rawName = String(d?.name ?? d?.label ?? "").trim();
            const derived =
                /^[A-Za-z]:\\?$/.test(path) ? path.slice(0, 2).toUpperCase() : path;

            const name = rawName
                ? (rawName.endsWith("\\") && /^[A-Za-z]:\\$/.test(rawName) ? rawName.slice(0, 2) : rawName)
                : derived;

            return { name, path } satisfies DriveItem;
        })
        .filter(Boolean) as DriveItem[];

    return drives;
}

export async function listDirectory(
    deviceId: string,
    path: string,
    recursive?: boolean
): Promise<{ path: string; items: FsItem[] }> {
    const { id } = await fileList(deviceId, path, recursive);
    const job = await waitForJob(id, { timeoutMs: 90_000, pollMs: 700 });

    if (String(job.status || "").toLowerCase() !== "succeeded") {
        const msg = String(job.stderr || job.stdout || "List failed");
        throw new Error(msg);
    }

    const out = job.parsed_stdout ?? (job.stdout ? tryParse(job.stdout) : null);

    const realPath = String(out?.path ?? out?.cwd ?? out?.dir ?? path);
    const items = coerceItems(out?.items ?? out);

    return { path: realPath, items };
}

export async function readFileBase64(
    deviceId: string,
    path: string,
    maxBytes?: number
): Promise<{ path: string; contentBase64: string; encoding?: string }> {
    const { id } = await fileRead(deviceId, path, maxBytes);
    const job = await waitForJob(id, { timeoutMs: 120_000, pollMs: 700 });

    if (String(job.status || "").toLowerCase() !== "succeeded") {
        const msg = String(job.stderr || job.stdout || "Read failed");
        throw new Error(msg);
    }

    const out = job.parsed_stdout ?? (job.stdout ? tryParse(job.stdout) : null);

    const contentBase64 =
        String(
            out?.contentBase64 ??
            out?.content_base64 ??
            out?.dataBase64 ??
            out?.data_base64 ??
            out?.base64 ??
            ""
        ).trim() || String(job.stdout ?? "").trim();

    if (!contentBase64) throw new Error("Read succeeded but no content was returned.");

    const realPath = String(out?.path ?? out?.fullPath ?? out?.file ?? path);
    const encoding = out?.encoding ? String(out.encoding) : undefined;

    return { path: realPath, contentBase64, encoding };
}
