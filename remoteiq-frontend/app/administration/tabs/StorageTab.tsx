/* remoteiq-frontend/app/administration/tabs/StorageTab.tsx */
"use client";

import * as React from "react";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
    Cloud,
    Plus,
    Save,
    Trash2,
    RefreshCcw,
    Cable,
    Database,
    Copy,
    Upload,
    Download as DownloadIcon,
    ShieldCheck,
    AlertTriangle,
    Eye,
    EyeOff,
} from "lucide-react";
import { LabeledInput, LabeledNumber, CheckToggle } from "../helpers";
import { jfetch } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
    listStorageConnections,
    type StorageConnection,
    type S3ConnConfig,
    type NextcloudConnConfig,
    type GDriveConnConfig,
    type SftpConnConfig,
    type DependentsResp,
} from "@/lib/storage";

// --- Toast helper
type ToastOpts = Parameters<ReturnType<typeof useToast>["toast"]>[0];
function toastWithDefaults(
    t: ReturnType<typeof useToast>["toast"],
    opts: ToastOpts
) {
    t({ duration: 6000, ...opts } as any);
}

type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";
type Env = "dev" | "staging" | "prod";

function looksLikeUrl(u: string) {
    try {
        const url = new URL(u);
        return !!url.protocol && !!url.host;
    } catch {
        return false;
    }
}
function isAbsPath(p: string) {
    return p.startsWith("/") || /^[A-Za-z]:\\/.test(p);
}
function toCsv(arr?: string[]) {
    return (arr ?? []).join(", ");
}

export default function StorageTab() {
    const { toast } = useToast();
    const didInitRef = React.useRef(false);

    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [testing, setTesting] = React.useState(false);
    const [browsing, setBrowsing] = React.useState<null | "nextcloud">(null);

    const [connections, setConnections] = React.useState<StorageConnection[]>([]);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);

    const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
    const [errors, setErrors] = React.useState<string[]>([]);
    const [showNcPassword, setShowNcPassword] = React.useState(false);

    // raw text state for tags so commas/spaces aren't eaten while typing
    const [tagsRaw, setTagsRaw] = React.useState<string>("");

    const [draft, setDraft] = React.useState<StorageConnection>({
        id: "",
        name: "",
        kind: "s3",
        config: {
            provider: "aws",
            region: "us-east-1",
            bucket: "",
            prefix: "",
            pathStyle: false,
            sse: "none",
        } as S3ConnConfig,
        meta: {
            environment: "dev",
            tags: [],
            defaultFor: { backups: false, exports: false, artifacts: false },
            encryptionAtRest: false,
            compression: "none",
        },
        capabilities: {
            canUse: true,
            canEdit: true,
            canRotate: true,
            canDelete: true,
        },
        health: { status: "unknown" },
    });

    const selected = React.useMemo(
        () => connections.find((c) => c.id === selectedId) ?? null,
        [connections, selectedId]
    );

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const { items } = await listStorageConnections();
            const list = items ?? [];
            setConnections(list);
            setSelectedId((prev) => prev ?? (list[0]?.id ?? null));
        } catch (err: any) {
            setConnections([]);
            setSelectedId(null);
            toastWithDefaults(toast, {
                id: "storage-unreachable",
                title: "Storage API unreachable",
                description:
                    err?.message ?? "Could not load connections. Check backend URL / auth.",
                variant: "destructive",
                kind: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    React.useEffect(() => {
        if (didInitRef.current) return;
        didInitRef.current = true;
        refresh();
    }, [refresh]);

    React.useEffect(() => {
        if (!selected) return;
        const cfg = { ...(selected.config as any) };
        if (selected.kind === "nextcloud") cfg.password = "";
        if (selected.kind === "sftp") {
            cfg.password = "";
            cfg.privateKeyPem = "";
            cfg.passphrase = "";
        }
        if (selected.kind === "s3") {
            cfg.accessKeyId = "";
            cfg.secretAccessKey = "";
        }

        setDraft({
            id: selected.id,
            name: selected.name,
            kind: selected.kind,
            config: cfg,
            meta:
                selected.meta ?? {
                    environment: "dev",
                    tags: [],
                    defaultFor: { backups: false, exports: false, artifacts: false },
                    encryptionAtRest: false,
                    compression: "none",
                },
            capabilities:
                selected.capabilities ?? {
                    canUse: true,
                    canEdit: true,
                    canRotate: true,
                    canDelete: true,
                },
            health: selected.health ?? { status: "unknown" },
            hasSecret: selected.hasSecret,
        });
        setTagsRaw(toCsv(selected.meta?.tags ?? []));
        setErrors([]);
    }, [selected]);

    function resetToNew(kind: StorageKind = "s3") {
        setSelectedId(null);
        const base: StorageConnection = {
            id: "",
            name: "",
            kind,
            config: {} as any,
            meta: {
                environment: "dev",
                tags: [],
                defaultFor: { backups: false, exports: false, artifacts: false },
                encryptionAtRest: false,
                compression: "none",
            },
            capabilities: {
                canUse: true,
                canEdit: true,
                canRotate: true,
                canDelete: true,
            },
            health: { status: "unknown" },
        };
        if (kind === "s3") {
            base.config = {
                provider: "aws",
                region: "us-east-1",
                bucket: "",
                prefix: "",
                pathStyle: false,
                sse: "none",
                kmsKeyId: "",
                accessKeyId: "",
                secretAccessKey: "",
                roleArn: "",
                externalId: "",
                sessionDurationSec: 3600,
            } as S3ConnConfig;
        } else if (kind === "nextcloud") {
            base.config = {
                webdavUrl: "",
                username: "",
                password: "",
                path: "/Backups/RemoteIQ",
            } as NextcloudConnConfig;
        } else if (kind === "gdrive") {
            base.config = {
                folderId: "",
                accountEmail: "",
                authMode: undefined,
            } as GDriveConnConfig;
        } else {
            base.config = {
                host: "",
                port: 22,
                username: "",
                password: "",
                privateKeyPem: "",
                passphrase: "",
                hostKeyFingerprint: "",
                path: "/srv/remoteiq/backups",
            } as SftpConnConfig;
        }
        setDraft(base);
        setTagsRaw("");
        setErrors([]);
    }

    function validate(): string[] {
        const errs: string[] = [];
        if (!draft.name?.trim()) errs.push("Name is required.");
        if (draft.kind === "s3") {
            const c = draft.config as S3ConnConfig;
            if (!c.bucket?.trim()) errs.push("S3 bucket is required.");
            if (c.sse === "aws:kms" && !c.kmsKeyId?.trim())
                errs.push("KMS Key ID is required for aws:kms.");
            if (
                c.sessionDurationSec &&
                (c.sessionDurationSec < 900 || c.sessionDurationSec > 43200)
            ) {
                errs.push("STS session duration must be between 900 and 43200 seconds.");
            }
        }
        if (draft.kind === "nextcloud") {
            const c = draft.config as NextcloudConnConfig;
            if (!looksLikeUrl(c.webdavUrl || "")) errs.push("WebDAV URL looks invalid.");
            if (!c.username?.trim()) errs.push("Nextcloud username is required.");
            if (!c.path?.trim() || !c.path.startsWith("/"))
                errs.push("Nextcloud folder path must start with '/'.");
        }
        if (draft.kind === "gdrive") {
            const c = draft.config as GDriveConnConfig;
            if (!c.folderId?.trim()) errs.push("Google Drive Folder ID is required.");
        }
        if (draft.kind === "sftp") {
            const c = draft.config as SftpConnConfig;
            if (!c.host?.trim()) errs.push("SFTP host is required.");
            if (!c.username?.trim()) errs.push("SFTP username is required.");
            if (!c.path?.trim() || !isAbsPath(c.path))
                errs.push("SFTP path must be an absolute path.");
            if (c.privateKeyPem && c.privateKeyPem.length < 64)
                errs.push("SFTP private key looks too short.");
            if (c.hostKeyFingerprint && !/^SHA256:[A-Za-z0-9+/=]+$/.test(c.hostKeyFingerprint)) {
                errs.push("Host key fingerprint must look like 'SHA256:xxxx'.");
            }
        }
        return errs;
    }

    const canEdit = draft.capabilities?.canEdit !== false;
    const canDelete = draft.capabilities?.canDelete !== false;
    const onIfEditable =
        <T,>(fn: (v: T) => void) =>
            (v: T) => {
                if (canEdit) fn(v);
            };

    async function saveDraft(asCopy = false) {
        const errs = validate();
        setErrors(errs);
        if (errs.length) {
            errs.forEach((e) =>
                toast({
                    title: e,
                    variant: "destructive",
                    kind: "destructive",
                })
            );
            return;
        }
        setSaving(true);
        try {
            const cfg: any = { ...(draft.config as any) };
            if (draft.kind === "nextcloud" && !cfg.password) delete cfg.password;
            if (draft.kind === "sftp") {
                if (!cfg.password) delete cfg.password;
                if (!cfg.privateKeyPem) delete cfg.privateKeyPem;
                if (!cfg.passphrase) delete cfg.passphrase;
            }
            if (draft.kind === "s3") {
                if (!cfg.accessKeyId) delete cfg.accessKeyId;
                if (!cfg.secretAccessKey) delete cfg.secretAccessKey;
                if (!cfg.roleArn) delete cfg.roleArn;
                if (!cfg.externalId) delete cfg.externalId;
                if (!cfg.sessionDurationSec) delete cfg.sessionDurationSec;
            }
            // gdrive: we intentionally keep serviceAccountJson in config on save;
            // backend will move it to secrets.

            const payload = {
                id: asCopy ? undefined : draft.id || undefined,
                name: asCopy ? `${draft.name} (copy)` : draft.name.trim(),
                kind: draft.kind,
                config: cfg,
                meta: draft.meta,
            };

            const path =
                !asCopy && draft.id
                    ? `/api/admin/storage/connections/${draft.id}`
                    : "/api/admin/storage/connections";
            await jfetch(path, {
                method: !asCopy && draft.id ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
            });

            toast({
                title: asCopy ? "Connection duplicated" : "Connection saved",
                variant: "success",
                kind: "success",
            });
            await refresh();

            setDraft((d) => {
                const clean = { ...d };
                if (clean.kind === "nextcloud")
                    (clean.config as NextcloudConnConfig).password = "";
                if (clean.kind === "sftp") {
                    (clean.config as SftpConnConfig).password = "";
                    (clean.config as SftpConnConfig).privateKeyPem = "";
                    (clean.config as SftpConnConfig).passphrase = "";
                }
                if (clean.kind === "s3") {
                    (clean.config as S3ConnConfig).accessKeyId = "";
                    (clean.config as S3ConnConfig).secretAccessKey = "";
                }
                // gdrive: leave as-is; sensitive JSON is already moved server-side
                return clean;
            });
            setErrors([]);
        } catch (e: any) {
            toast({
                title: e?.message ?? "Save failed",
                variant: "destructive",
                kind: "destructive",
            });
        } finally {
            setSaving(false);
        }
    }

    async function testDraft() {
        const errs = validate();
        setErrors(errs);
        if (errs.length) {
            errs.forEach((e) =>
                toast({
                    title: e,
                    variant: "destructive",
                    kind: "destructive",
                })
            );
            return;
        }
        setTesting(true);
        try {
            const cfg: any = { ...(draft.config as any) };
            if (draft.kind === "nextcloud" && !cfg.password) delete cfg.password;
            if (draft.kind === "sftp") {
                if (!cfg.password) delete cfg.password;
                if (!cfg.privateKeyPem) delete cfg.privateKeyPem;
                if (!cfg.passphrase) delete cfg.passphrase;
            }
            if (draft.kind === "s3") {
                if (!cfg.accessKeyId) delete cfg.accessKeyId;
                if (!cfg.secretAccessKey) delete cfg.secretAccessKey;
            }

            const res = await jfetch<{
                ok: boolean;
                phases?: Record<string, boolean>;
                detail?: string;
            }>("/api/admin/storage/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: {
                    id: draft.id || undefined,
                    kind: draft.kind,
                    config: cfg,
                    meta: draft.meta,
                    probe: "write-read-delete",
                },
            });
            const detail = res?.phases
                ? ` (${Object.entries(res.phases)
                    .map(([k, v]) => `${k}:${v ? "ok" : "fail"}`)
                    .join(", ")})`
                : res?.detail || "";
            toast({
                title: res?.ok ? "Connection healthy" : "Connection check failed",
                description: detail,
                variant: res?.ok ? "success" : "destructive",
                kind: res?.ok ? "success" : "destructive",
            });
            refresh();
        } catch (e: any) {
            toast({
                title: e?.message ?? "Test failed",
                variant: "destructive",
                kind: "destructive",
            });
        } finally {
            setTesting(false);
        }
    }

    async function removeSelected() {
        if (!selected) return;
        try {
            let deps: DependentsResp | null = null;
            try {
                deps = await jfetch<DependentsResp>(
                    `/api/admin/storage/connections/${selected.id}/dependents`
                );
            } catch { }
            const used = (deps?.features ?? []).filter((f) => (f.ids?.length ?? 0) > 0);
            if (used.length > 0) {
                const lines = used
                    .map(
                        (f) => `${f.name}${f.ids && f.ids.length ? ` (${f.ids.length})` : ""}`
                    )
                    .join(", ");
                toast({
                    title: "Cannot delete: connection in use",
                    description: `Remove usages first: ${lines}`,
                    variant: "destructive",
                    kind: "destructive",
                });
                return;
            }
            await jfetch(`/api/admin/storage/connections/${selected.id}`, {
                method: "DELETE",
            });
            toast({
                title: "Connection deleted",
                variant: "default",
                kind: "default",
            });
            await refresh();
            setSelectedId((prev) => {
                const list = connections.filter((c) => c.id !== selected.id);
                return list[0]?.id ?? null;
            });
        } catch (e: any) {
            toast({
                title: e?.message ?? "Delete failed",
                variant: "destructive",
                kind: "destructive",
            });
        }
    }

    function exportJson() {
        const out = { ...draft, config: { ...(draft.config as any) } };
        if (out.kind === "nextcloud") delete (out.config as any).password;
        if (out.kind === "sftp") {
            delete (out.config as any).password;
            delete (out.config as any).privateKeyPem;
            delete (out.config as any).passphrase;
        }
        if (out.kind === "s3") {
            delete (out.config as any).accessKeyId;
            delete (out.config as any).secretAccessKey;
        }
        const blob = new Blob([JSON.stringify(out, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${draft.name || "connection"}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const obj = JSON.parse(String(reader.result) || "{}");

                // --- Branch 1: Imported an exported StorageConnection JSON (our own format)
                const looksLikeConnection =
                    obj &&
                    typeof obj === "object" &&
                    obj.kind &&
                    obj.config &&
                    (typeof obj.name === "string" || obj.name === "");

                // --- Branch 2: Imported a raw Google service account JSON
                const looksLikeGService =
                    obj &&
                    typeof obj === "object" &&
                    obj.type === "service_account" &&
                    typeof obj.client_email === "string" &&
                    typeof obj.private_key === "string";

                if (looksLikeConnection) {
                    // sanitize secrets as usual
                    if (obj.kind === "nextcloud" && obj.config) obj.config.password = "";
                    if (obj.kind === "sftp" && obj.config) {
                        obj.config.password = "";
                        obj.config.privateKeyPem = "";
                        obj.config.passphrase = "";
                    }
                    if (obj.kind === "s3" && obj.config) {
                        obj.config.accessKeyId = "";
                        obj.config.secretAccessKey = "";
                    }
                    setDraft(obj);
                    setTagsRaw(toCsv(obj?.meta?.tags ?? []));
                    setErrors([]);
                    toast({
                        title: "Imported connection JSON",
                        variant: "success",
                        kind: "success",
                    });
                    return;
                }

                if (looksLikeGService) {
                    // Build a brand-new GDrive draft using the service account JSON
                    const suggestedName =
                        (obj.client_email as string)
                            ?.replace("@", " @ ")
                            ?.replace(".iam.gserviceaccount.com", "") ||
                        obj.project_id ||
                        "Google Drive (Service Account)";

                    const newDraft: StorageConnection = {
                        id: "",
                        name: suggestedName,
                        kind: "gdrive",
                        config: {
                            folderId: "",
                            // Let backend move this into secrets via partitionSecrets
                            serviceAccountJson: obj,
                            accountEmail: obj.client_email,
                            authMode: "service_account",
                        } as unknown as GDriveConnConfig,
                        meta: {
                            environment: "dev",
                            tags: ["gdrive", "backups"],
                            defaultFor: { backups: false, exports: false, artifacts: false },
                            encryptionAtRest: false,
                            compression: "none",
                        },
                        capabilities: {
                            canUse: true,
                            canEdit: true,
                            canRotate: true,
                            canDelete: true,
                        },
                        health: { status: "unknown" },
                    };

                    setDraft(newDraft);
                    setTagsRaw(toCsv(newDraft.meta?.tags ?? []));
                    setErrors([]);

                    toast({
                        title: "Google service account imported",
                        description:
                            "Paste the Drive Folder ID and click Save. Remember to share that folder with this service account email.",
                        variant: "success",
                        kind: "success",
                    });
                    return;
                }

                // Fallback: not recognized
                throw new Error(
                    "Unsupported JSON. Import an exported connection JSON or a Google service account JSON."
                );
            } catch (err: any) {
                toast({
                    title: "Invalid JSON",
                    description: err?.message,
                    variant: "destructive",
                    kind: "destructive",
                });
            }
        };
        reader.readAsText(file);
        e.currentTarget.value = "";
    }

    async function browseNextcloud() {
        if (draft.kind !== "nextcloud") return;
        setBrowsing("nextcloud");
        try {
            const cfg: any = { ...(draft.config as any) };
            delete cfg.password; // ensure server reads stored secret

            const res = await jfetch<{
                ok: boolean;
                dirs?: string[];
                error?: string;
            }>("/api/admin/storage/browse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: {
                    kind: "nextcloud",
                    connectionId: draft.id || undefined,
                    config: cfg,
                    path: (draft.config as any).path || "/",
                },
            });

            const dirs = res?.dirs ?? [];
            setDraft((d) => ({
                ...d,
                config: { ...(d.config as any), _browse: dirs },
            }));
            if (!res?.ok) throw new Error(res?.error || "Browse failed");
        } catch (e: any) {
            toast({
                title: e?.message ?? "Browse failed",
                variant: "destructive",
                kind: "destructive",
            });
        } finally {
            setBrowsing(null);
        }
    }

    const healthColor =
        draft.health?.status === "healthy"
            ? "bg-emerald-500"
            : draft.health?.status === "unhealthy"
                ? "bg-red-500"
                : "bg-zinc-400";

    const hasBlockingErrors = errors.length > 0;

    return (
        <TabsContent value="storage" className="mt-0">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Cloud className="h-5 w-5" />
                        Storage
                        <Badge variant="secondary" className="ml-1">
                            Connections
                        </Badge>
                        <span
                            className={`inline-block h-2 w-2 rounded-full ${healthColor}`}
                            title={`Health: ${draft.health?.status || "unknown"}`}
                        />
                        <span className="text-xs text-muted-foreground">
                            {draft.health?.lastCheckedAt
                                ? `Last checked: ${(draft.health.lastCheckedAt || "")
                                    .replace("T", " ")
                                    .slice(0, 16)}`
                                : "Not checked"}
                        </span>
                        {draft.health?.lastResult && (
                            <span className="text-xs text-muted-foreground">
                                · {draft.health.lastResult}
                            </span>
                        )}
                    </CardTitle>
                    <CardDescription>
                        Define reusable storage connections. Backups/Exports/Artifacts
                        reference a connection by name so credentials remain centralized and
                        secure.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-8">
                    {errors.length > 0 && (
                        <div className="rounded-md border border-red-300/60 bg-red-50/40 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                            <div className="font-medium mb-1">Please fix the following:</div>
                            <ul className="list-disc ml-5 space-y-0.5">
                                {errors.map((e, i) => (
                                    <li key={i}>{e}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="rounded-md border p-4 space-y-4 bg-muted/30">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Database className="h-4 w-4" />
                                <div className="font-medium">Connections</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => refresh()}
                                >
                                    <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => resetToNew("s3")}
                                    disabled={!canEdit}
                                >
                                    <Plus className="h-4 w-4 mr-2" /> New
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => saveDraft(true)}
                                    disabled={!canEdit}
                                >
                                    <Copy className="h-4 w-4 mr-2" /> Save as copy
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={exportJson}
                                >
                                    <DownloadIcon className="h-4 w-4 mr-2" /> Export JSON
                                </Button>
                                <label
                                    className={`inline-flex items-center gap-2 text-sm px-3 py-2 rounded-md border ${canEdit ? "cursor-pointer" : "opacity-60 cursor-not-allowed"
                                        }`}
                                >
                                    <Upload className="h-4 w-4" />
                                    Import JSON
                                    <input
                                        type="file"
                                        accept="application/json"
                                        onChange={canEdit ? importFile : undefined}
                                        className="hidden"
                                        disabled={!canEdit}
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-12 items-start">
                            <div className="md:col-span-9">
                                <div className="grid gap-3 md:grid-cols-12 items-start">
                                    <div className="md:col-span-4 self-start">
                                        <Label className="text-sm">Edit existing connection</Label>
                                        {loading ? (
                                            <Skeleton className="h-9 w-full" />
                                        ) : (
                                            <Select
                                                value={selectedId ?? ""}
                                                onValueChange={onIfEditable<string | "">((v) =>
                                                    setSelectedId(v || null)
                                                )}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={
                                                            connections.length
                                                                ? "Choose to edit…"
                                                                : "No connections yet"
                                                        }
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {connections.map((c) => (
                                                        <SelectItem key={c.id} value={c.id}>
                                                            {c.name}{" "}
                                                            <span className="text-muted-foreground">· {c.kind}</span>
                                                        </SelectItem>
                                                    ))}
                                                    {connections.length === 0 && (
                                                        <SelectItem value="__none" disabled>
                                                            No connections
                                                        </SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>

                                    <div className="md:col-span-4 self-start">
                                        <Label className="text-sm">Kind</Label>
                                        <Select
                                            value={draft.kind}
                                            onValueChange={onIfEditable<StorageKind>((v) => resetToNew(v))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select kind" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="s3">S3 / MinIO</SelectItem>
                                                <SelectItem value="nextcloud">Nextcloud (WebDAV)</SelectItem>
                                                <SelectItem value="gdrive">Google Drive</SelectItem>
                                                <SelectItem value="sftp">Remote SFTP</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="md:col-span-4 self-start">
                                        <LabeledInput
                                            label="Name"
                                            value={draft.name}
                                            onChange={onIfEditable<string>((v) =>
                                                setDraft((d) => ({ ...d, name: v }))
                                            )}
                                            placeholder="e.g. Prod S3, Offsite Nextcloud, GDrive Backups"
                                        />
                                    </div>

                                    <div className="md:col-span-4 self-start">
                                        <Label className="text-sm">Environment</Label>
                                        <Select
                                            value={draft.meta?.environment ?? "dev"}
                                            onValueChange={onIfEditable<Env>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    meta: { ...(d.meta || {}), environment: v },
                                                }))
                                            )}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="dev">Dev</SelectItem>
                                                <SelectItem value="staging">Staging</SelectItem>
                                                <SelectItem value="prod">Prod</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* TAGS */}
                                    <div className="md:col-span-8 self-start">
                                        <div className="grid gap-1">
                                            <Label className="text-sm">Tags (comma-separated)</Label>
                                            <Input
                                                type="text"
                                                inputMode="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={tagsRaw}
                                                onChange={(e) => {
                                                    if (!canEdit) return;
                                                    const v = e.currentTarget.value;
                                                    setTagsRaw(v);
                                                    const parsed = v
                                                        .split(",")
                                                        .map((x) => x.trim())
                                                        .filter(Boolean);
                                                    setDraft((d) => ({
                                                        ...d,
                                                        meta: { ...(d.meta || {}), tags: parsed },
                                                    }));
                                                }}
                                                placeholder="backup, offsite, cost-optimized"
                                            />
                                            <span className="text-[11px] text-muted-foreground">
                                                Separate tags with commas. Spaces are OK.
                                            </span>
                                        </div>
                                    </div>

                                    <div className="md:col-span-12">
                                        <p className="text-xs text-muted-foreground">
                                            Backups choose a connection in the{" "}
                                            <span className="font-medium">Backups</span> tab. This
                                            selector is only for editing/testing saved connections.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="md:col-span-3 md:self-stretch">
                                <div className="rounded-md border p-3 h-full">
                                    <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
                                        Defaults
                                    </div>
                                    <div className="mt-2 space-y-2">
                                        <CheckToggle
                                            label="Default for Backups"
                                            checked={!!draft.meta?.defaultFor?.backups}
                                            onChange={onIfEditable<boolean>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    meta: {
                                                        ...(d.meta || {}),
                                                        defaultFor: {
                                                            ...(d.meta?.defaultFor || {}),
                                                            backups: v,
                                                        },
                                                    },
                                                }))
                                            )}
                                        />
                                        <CheckToggle
                                            label="Default for Exports"
                                            checked={!!draft.meta?.defaultFor?.exports}
                                            onChange={onIfEditable<boolean>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    meta: {
                                                        ...(d.meta || {}),
                                                        defaultFor: {
                                                            ...(d.meta?.defaultFor || {}),
                                                            exports: v,
                                                        },
                                                    },
                                                }))
                                            )}
                                        />
                                        <CheckToggle
                                            label="Default for Artifacts"
                                            checked={!!draft.meta?.defaultFor?.artifacts}
                                            onChange={onIfEditable<boolean>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    meta: {
                                                        ...(d.meta || {}),
                                                        defaultFor: {
                                                            ...(d.meta?.defaultFor || {}),
                                                            artifacts: v,
                                                        },
                                                    },
                                                }))
                                            )}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Per-kind form */}
                    <div className="rounded-md border p-4 bg-muted/20 space-y-6">
                        {draft.kind === "s3" && (
                            <div className="space-y-6">
                                <div className="grid gap-4 md:grid-cols-3">
                                    <div className="grid gap-1">
                                        <Label className="text-sm">Provider</Label>
                                        <Select
                                            value={(draft.config as S3ConnConfig)?.provider ?? "aws"}
                                            onValueChange={onIfEditable<"aws" | "minio" | "wasabi" | "other">(
                                                (v) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        config: { ...(d.config as S3ConnConfig), provider: v },
                                                    }))
                                            )}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="aws">AWS S3</SelectItem>
                                                <SelectItem value="minio">MinIO</SelectItem>
                                                <SelectItem value="wasabi">Wasabi</SelectItem>
                                                <SelectItem value="other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <LabeledInput
                                        label="Region"
                                        value={(draft.config as S3ConnConfig)?.region ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), region: v },
                                            }))
                                        )}
                                    />
                                    <div className="grid gap-1">
                                        <LabeledInput
                                            label="Bucket"
                                            value={(draft.config as S3ConnConfig)?.bucket ?? ""}
                                            onChange={onIfEditable<string>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    config: { ...(d.config as S3ConnConfig), bucket: v },
                                                }))
                                            )}
                                        />
                                        {!errors.length &&
                                            !((draft.config as S3ConnConfig)?.bucket ?? "").trim() && (
                                                <span className="text-[11px] text-muted-foreground">
                                                    Required for S3 connections.
                                                </span>
                                            )}
                                    </div>
                                    <LabeledInput
                                        label="Endpoint (MinIO/Other)"
                                        value={(draft.config as S3ConnConfig)?.endpoint ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), endpoint: v },
                                            }))
                                        )}
                                    />
                                    <LabeledInput
                                        label="Key prefix (optional)"
                                        value={(draft.config as S3ConnConfig)?.prefix ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), prefix: v },
                                            }))
                                        )}
                                    />
                                    <div className="flex items-center gap-4 mt-6">
                                        <CheckToggle
                                            label="Path-style access"
                                            checked={!!(draft.config as S3ConnConfig)?.pathStyle}
                                            onChange={onIfEditable<boolean>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    config: { ...(d.config as S3ConnConfig), pathStyle: v },
                                                }))
                                            )}
                                        />
                                    </div>
                                </div>

                                <Separator />

                                <div className="grid gap-4 md:grid-cols-3">
                                    <div className="grid gap-1">
                                        <Label className="text-sm">Server-side encryption</Label>
                                        <Select
                                            value={((draft.config as S3ConnConfig)?.sse as any) ?? "none"}
                                            onValueChange={onIfEditable<"none" | "AES256" | "aws:kms">(
                                                (v) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        config: { ...(d.config as S3ConnConfig), sse: v },
                                                    }))
                                            )}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">None</SelectItem>
                                                <SelectItem value="AES256">AES256</SelectItem>
                                                <SelectItem value="aws:kms">AWS KMS</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {(draft.config as S3ConnConfig)?.sse === "aws:kms" && (
                                        <div className="grid gap-1">
                                            <LabeledInput
                                                label="KMS Key ID (ARN)"
                                                value={(draft.config as S3ConnConfig)?.kmsKeyId ?? ""}
                                                onChange={onIfEditable<string>((v) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        config: { ...(d.config as S3ConnConfig), kmsKeyId: v },
                                                    }))
                                                )}
                                            />
                                            {!errors.length &&
                                                (draft.config as S3ConnConfig)?.sse === "aws:kms" &&
                                                !((draft.config as S3ConnConfig)?.kmsKeyId ?? "").trim() && (
                                                    <span className="text-[11px] text-muted-foreground">
                                                        Required when using AWS KMS.
                                                    </span>
                                                )}
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                <div className="grid gap-4 md:grid-cols-3">
                                    <LabeledInput
                                        label="Access Key ID (optional)"
                                        value={(draft.config as S3ConnConfig)?.accessKeyId ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), accessKeyId: v },
                                            }))
                                        )}
                                        placeholder={draft.hasSecret?.s3Credentials ? "•••••••• (set)" : ""}
                                    />
                                    <LabeledInput
                                        label="Secret Access Key (optional)"
                                        type="password"
                                        value={(draft.config as S3ConnConfig)?.secretAccessKey ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as S3ConnConfig),
                                                    secretAccessKey: v,
                                                },
                                            }))
                                        )}
                                        placeholder={draft.hasSecret?.s3Credentials ? "•••••••• (set)" : ""}
                                    />
                                    <LabeledInput
                                        label="Assume Role ARN (optional)"
                                        value={(draft.config as S3ConnConfig)?.roleArn ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), roleArn: v },
                                            }))
                                        )}
                                        placeholder="arn:aws:iam::123456789012:role/RemoteIQBackupRole"
                                    />
                                    <LabeledInput
                                        label="External ID (optional)"
                                        value={(draft.config as S3ConnConfig)?.externalId ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as S3ConnConfig), externalId: v },
                                            }))
                                        )}
                                    />
                                    <LabeledNumber
                                        label="STS Session Duration (sec)"
                                        value={(draft.config as S3ConnConfig)?.sessionDurationSec ?? 3600}
                                        onChange={onIfEditable<string | number>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as S3ConnConfig),
                                                    sessionDurationSec: v === "" ? 3600 : Number(v),
                                                },
                                            }))
                                        )}
                                    />
                                </div>

                                {(draft.config as S3ConnConfig)?.bucketLifecycleSummary && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <ShieldCheck className="h-3.5 w-3.5" />
                                        Lifecycle: {(draft.config as S3ConnConfig).bucketLifecycleSummary}
                                    </div>
                                )}
                            </div>
                        )}

                        {draft.kind === "nextcloud" && (
                            <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-3">
                                    <LabeledInput
                                        label="WebDAV URL"
                                        value={(draft.config as NextcloudConnConfig)?.webdavUrl ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as NextcloudConnConfig),
                                                    webdavUrl: v,
                                                },
                                            }))
                                        )}
                                        placeholder="https://cloud.example.com/remote.php/dav/files/username/"
                                    />
                                    <LabeledInput
                                        label="Username"
                                        value={(draft.config as NextcloudConnConfig)?.username ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as NextcloudConnConfig),
                                                    username: v,
                                                },
                                            }))
                                        )}
                                    />

                                    {/* Password with eye toggle */}
                                    <div className="grid gap-1">
                                        <Label className="text-sm">Password</Label>
                                        <div className="relative">
                                            <Input
                                                type={showNcPassword ? "text" : "password"}
                                                autoComplete="new-password"
                                                name="nc-password"
                                                data-lpignore="true"
                                                data-1p-ignore
                                                value={(draft.config as NextcloudConnConfig)?.password ?? ""}
                                                onChange={(e) => {
                                                    if (!canEdit) return;
                                                    const v = e.currentTarget.value;
                                                    setDraft((d) => ({
                                                        ...d,
                                                        config: {
                                                            ...(d.config as NextcloudConnConfig),
                                                            password: v,
                                                        },
                                                    }));
                                                }}
                                                placeholder={
                                                    draft.hasSecret?.nextcloudPassword ? "•••••••• (set)" : ""
                                                }
                                                className="pr-10"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowNcPassword((s) => !s)}
                                                className="absolute inset-y-0 right-2 inline-flex items-center text-muted-foreground hover:text-foreground"
                                                aria-label={showNcPassword ? "Hide password" : "Show password"}
                                                tabIndex={0}
                                            >
                                                {showNcPassword ? (
                                                    <EyeOff className="h-4 w-4" />
                                                ) : (
                                                    <Eye className="h-4 w-4" />
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                    <LabeledInput
                                        label="Folder path"
                                        value={(draft.config as NextcloudConnConfig)?.path ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as NextcloudConnConfig), path: v },
                                            }))
                                        )}
                                        placeholder="/Backups/RemoteIQ"
                                    />
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={browseNextcloud}
                                        disabled={browsing === "nextcloud" || !canEdit}
                                    >
                                        <RefreshCcw className="h-4 w-4 mr-2" />
                                        {browsing === "nextcloud" ? "Browsing…" : "Browse folders"}
                                    </Button>
                                    <span className="text-xs text-muted-foreground">
                                        Fetches subfolders via WebDAV PROPFIND.
                                    </span>
                                </div>

                                {!!(draft.config as NextcloudConnConfig)?._browse?.length && (
                                    <div className="text-xs">
                                        <div className="mb-1 text-muted-foreground">Pick a folder:</div>
                                        <div className="flex flex-wrap gap-2">
                                            {(draft.config as NextcloudConnConfig)._browse!.map((dir) => (
                                                <button
                                                    key={dir}
                                                    type="button"
                                                    onClick={() => {
                                                        if (!canEdit) return;
                                                        setDraft((d) => ({
                                                            ...d,
                                                            config: {
                                                                ...(d.config as NextcloudConnConfig),
                                                                path: dir,
                                                            },
                                                        }));
                                                    }}
                                                    className={`rounded border px-2 py-1 hover:bg-muted ${!canEdit ? "opacity-60 cursor-not-allowed" : ""
                                                        }`}
                                                >
                                                    {dir}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {draft.kind === "gdrive" && (
                            <div className="grid gap-4 md:grid-cols-3">
                                <LabeledInput
                                    label="Folder ID"
                                    value={(draft.config as GDriveConnConfig)?.folderId ?? ""}
                                    onChange={onIfEditable<string>((v) =>
                                        setDraft((d) => ({
                                            ...d,
                                            config: { ...(d.config as GDriveConnConfig), folderId: v },
                                        }))
                                    )}
                                    placeholder="1aBcD2EfGhIjKlMnOpQrStUvWxYz"
                                />
                                <div className="grid gap-1">
                                    <Label className="text-sm">Connected account</Label>
                                    <Input
                                        value={(draft.config as GDriveConnConfig)?.accountEmail ?? ""}
                                        readOnly
                                        placeholder="(from service account JSON)"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label className="text-sm">Auth mode</Label>
                                    <Input
                                        value={(draft.config as GDriveConnConfig)?.authMode ?? ""}
                                        readOnly
                                        placeholder="(server provided)"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground md:col-span-3">
                                    Import your Google <span className="font-medium">service account</span> JSON using
                                    the <span className="font-medium">Import JSON</span> button. Then paste the
                                    target Drive <span className="font-medium">Folder ID</span> and save. Be sure
                                    to share that folder with the service account email.
                                </p>
                            </div>
                        )}

                        {draft.kind === "sftp" && (
                            <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-3">
                                    <LabeledInput
                                        label="Host / IP"
                                        value={(draft.config as SftpConnConfig)?.host ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as SftpConnConfig), host: v },
                                            }))
                                        )}
                                    />
                                    <LabeledNumber
                                        label="Port"
                                        value={(draft.config as SftpConnConfig)?.port ?? 22}
                                        onChange={onIfEditable<string | number>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as SftpConnConfig),
                                                    port: v === "" ? 22 : Number(v),
                                                },
                                            }))
                                        )}
                                    />
                                    <LabeledInput
                                        label="Username"
                                        value={(draft.config as SftpConnConfig)?.username ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as SftpConnConfig),
                                                    username: v,
                                                },
                                            }))
                                        )}
                                    />
                                    <LabeledInput
                                        label="Password (optional)"
                                        type="password"
                                        value={(draft.config as SftpConnConfig)?.password ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as SftpConnConfig),
                                                    password: v,
                                                },
                                            }))
                                        )}
                                        placeholder={draft.hasSecret?.sftpPassword ? "•••••••• (set)" : ""}
                                    />
                                    <div className="md:col-span-3 grid md:grid-cols-3 gap-4">
                                        <div className="grid gap-1 md:col-span-2">
                                            <Label className="text-sm">Private key (PEM, optional)</Label>
                                            <textarea
                                                className="h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                                placeholder={
                                                    draft.hasSecret?.sftpPrivateKey
                                                        ? "•••••••• (set)"
                                                        : "-----BEGIN OPENSSH PRIVATE KEY-----"
                                                }
                                                value={(draft.config as SftpConnConfig)?.privateKeyPem ?? ""}
                                                onChange={(e) =>
                                                    canEdit &&
                                                    setDraft((d) => ({
                                                        ...d,
                                                        config: {
                                                            ...(d.config as SftpConnConfig),
                                                            privateKeyPem: e.target.value,
                                                        },
                                                    }))
                                                }
                                            />
                                        </div>
                                        <LabeledInput
                                            label="Passphrase (optional)"
                                            type="password"
                                            value={(draft.config as SftpConnConfig)?.passphrase ?? ""}
                                            onChange={onIfEditable<string>((v) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    config: { ...(d.config as SftpConnConfig), passphrase: v },
                                                }))
                                            )}
                                        />
                                    </div>
                                    <LabeledInput
                                        label="Host key fingerprint (pin, optional)"
                                        value={(draft.config as SftpConnConfig)?.hostKeyFingerprint ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: {
                                                    ...(d.config as SftpConnConfig),
                                                    hostKeyFingerprint: v,
                                                },
                                            }))
                                        )}
                                        placeholder="SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                    />
                                    <LabeledInput
                                        label="Directory (absolute)"
                                        value={(draft.config as SftpConnConfig)?.path ?? ""}
                                        onChange={onIfEditable<string>((v) =>
                                            setDraft((d) => ({
                                                ...d,
                                                config: { ...(d.config as SftpConnConfig), path: v },
                                            }))
                                        )}
                                        placeholder="/srv/remoteiq/backups"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="rounded-md border p-4">
                        <div className="grid gap-4 md:grid-cols-4">
                            <LabeledNumber
                                label="Bandwidth limit (MB/s, optional)"
                                value={draft.meta?.bandwidthLimitMBps ?? ""}
                                onChange={onIfEditable<string | number>((v) =>
                                    setDraft((d) => ({
                                        ...d,
                                        meta: {
                                            ...(d.meta || {}),
                                            bandwidthLimitMBps: v === "" ? undefined : Number(v),
                                        },
                                    }))
                                )}
                            />
                            <LabeledNumber
                                label="Concurrency (optional)"
                                value={draft.meta?.concurrency ?? ""}
                                onChange={onIfEditable<string | number>((v) =>
                                    setDraft((d) => ({
                                        ...d,
                                        meta: {
                                            ...(d.meta || {}),
                                            concurrency: v === "" ? undefined : Number(v),
                                        },
                                    }))
                                )}
                            />
                            <div className="grid gap-1">
                                <Label className="text-sm">Compression</Label>
                                <Select
                                    value={draft.meta?.compression ?? "none"}
                                    onValueChange={onIfEditable<"none" | "gzip" | "zstd">((v) =>
                                        setDraft((d) => ({
                                            ...d,
                                            meta: { ...(d.meta || {}), compression: v },
                                        }))
                                    )}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        <SelectItem value="gzip">Gzip</SelectItem>
                                        <SelectItem value="zstd">Zstd</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end">
                                <CheckToggle
                                    label="Pipeline encryption at rest"
                                    checked={!!draft.meta?.encryptionAtRest}
                                    onChange={onIfEditable<boolean>((v) =>
                                        setDraft((d) => ({
                                            ...d,
                                            meta: { ...(d.meta || {}), encryptionAtRest: v },
                                        }))
                                    )}
                                />
                            </div>
                        </div>

                        {(draft.meta?.createdBy ||
                            draft.meta?.updatedBy ||
                            draft.meta?.createdAt ||
                            draft.meta?.updatedAt) && (
                                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-3">
                                    {draft.meta?.createdBy && (
                                        <span>Created by: {draft.meta.createdBy}</span>
                                    )}
                                    {draft.meta?.createdAt && (
                                        <span>
                                            at {(draft.meta.createdAt || "").replace("T", " ").slice(0, 16)}
                                        </span>
                                    )}
                                    {draft.meta?.updatedBy && (
                                        <span>· Updated by: {draft.meta.updatedBy}</span>
                                    )}
                                    {draft.meta?.updatedAt && (
                                        <span>
                                            at {(draft.meta.updatedAt || "").replace("T", " ").slice(0, 16)}
                                        </span>
                                    )}
                                </div>
                            )}

                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button variant="outline" onClick={testDraft} disabled={testing || !canEdit}>
                                <RefreshCcw className="h-4 w-4 mr-2" />
                                {testing ? "Testing…" : "Test connection"}
                            </Button>

                            {selected && (
                                <>
                                    <Button
                                        variant="destructive"
                                        onClick={() => setConfirmDeleteOpen(true)}
                                        disabled={!canDelete}
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                                    </Button>
                                    <AlertDialog
                                        open={confirmDeleteOpen}
                                        onOpenChange={setConfirmDeleteOpen}
                                    >
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete connection?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This action cannot be undone. Any features that use{" "}
                                                    <span className="font-medium">{selected?.name}</span> will
                                                    stop working until you reconfigure them.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={removeSelected}
                                                    className="bg-red-600 text-white hover:bg-red-700"
                                                >
                                                    Delete
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </>
                            )}

                            {!canEdit && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <AlertTriangle className="h-3.5 w-3.5" /> You don’t have edit permission.
                                </span>
                            )}
                            <Button
                                onClick={() => saveDraft(false)}
                                disabled={saving || !canEdit || hasBlockingErrors}
                            >
                                <Save className="h-4 w-4 mr-2" />
                                {saving ? "Saving…" : "Save connection"}
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-md border p-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Cable className="h-4 w-4" /> How it integrates
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                            Features reference a <span className="font-medium">connection name</span>, not raw
                            credentials. This centralizes secrets, enables rotation &amp; RBAC,
                            and keeps the UI safer.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
    );
}
