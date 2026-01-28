// remoteiq-frontend/components/file-browser-tab.tsx
"use client";

import * as React from "react";
import {
    RefreshCw,
    Folder,
    File as FileIcon,
    Download,
    Upload,
    FolderPlus,
    Search,
    ChevronRight,
    ChevronDown,
    ClipboardCopy,
    Scissors,
    ClipboardPaste,
    Trash2,
    Pencil,
    MoveRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    FsItem,
    DriveItem,
    JobRow,
    listDrives,
    listDirectory,
    readFileBase64,
    fileWrite,
    fileMkdir,
    fileDelete,
    fileMove,
    fileCopy,
    waitForJob,
} from "@/lib/device-files-api";

/* ----------------------------- Helpers ----------------------------- */

function fmtBytes(n?: number | null) {
    if (n == null || !Number.isFinite(n) || n < 0) return "—";
    if (n === 0) return "0 B";
    const k = 1024;
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    const v = n / Math.pow(k, i);
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function sortFs(items: FsItem[]) {
    const arr = [...items];
    arr.sort((a, b) => {
        if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
    });
    return arr;
}

function isWindowsPath(p: string) {
    return /^[A-Za-z]:(\\|$)/.test(p);
}

function samePath(a: string, b: string) {
    if (isWindowsPath(a) || isWindowsPath(b)) return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

function baseName(p: string) {
    const s = String(p ?? "");
    const sep = s.includes("\\") ? "\\" : "/";
    const parts = s.split(sep).filter(Boolean);
    return parts[parts.length - 1] ?? s;
}

function dirName(p: string) {
    const s = String(p ?? "");
    const sep = s.includes("\\") ? "\\" : "/";
    const idx = s.lastIndexOf(sep);
    if (idx <= 0) return s; // root-ish
    return s.slice(0, idx + 1); // keep trailing sep for easy join
}

function joinPath(dir: string, name: string) {
    const d = String(dir ?? "");
    const n = String(name ?? "");
    if (!d) return n;
    if (!n) return d;
    const win = isWindowsPath(d) || d.includes("\\");
    const sep = win ? "\\" : "/";
    const d2 = d.endsWith(sep) ? d : d + sep;
    return d2 + n;
}

function toBase64FromArrayBuffer(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function downloadBase64AsFile(contentBase64: string, filename: string) {
    const b64 = String(contentBase64 ?? "").trim();
    if (!b64) return;

    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.bin";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Convert `{id}` (enqueue response) -> JobRow (terminal),
 * and throw useful errors if it did not succeed.
 */
async function runJob(
    jobRef: { id: string },
    opts?: { timeoutMs?: number; pollMs?: number; failMessage?: string }
): Promise<JobRow> {
    const jr = await waitForJob(jobRef.id, {
        timeoutMs: opts?.timeoutMs ?? 180_000,
        pollMs: opts?.pollMs ?? 800,
    });

    const status = String(jr.status || "").toLowerCase();
    if (status !== "succeeded") {
        const msg =
            String(jr.stderr || jr.stdout || opts?.failMessage || "Job failed").trim() ||
            "Job failed";
        throw new Error(msg);
    }

    return jr;
}

/* ----------------------------- Simple Context Menu ----------------------------- */

type MenuItem =
    | { kind: "item"; label: string; icon?: React.ReactNode; disabled?: boolean; onClick: () => void }
    | { kind: "sep" };

function useContextMenu() {
    const [open, setOpen] = React.useState(false);
    const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [items, setItems] = React.useState<MenuItem[]>([]);
    const menuRef = React.useRef<HTMLDivElement | null>(null);

    const close = React.useCallback(() => setOpen(false), []);

    const show = React.useCallback((e: React.MouseEvent, nextItems: MenuItem[]) => {
        e.preventDefault();
        e.stopPropagation();
        setPos({ x: e.clientX, y: e.clientY });
        setItems(nextItems);
        setOpen(true);
    }, []);

    React.useEffect(() => {
        if (!open) return;

        const onMouseDown = (ev: MouseEvent) => {
            const el = menuRef.current;
            if (!el) return;
            if (ev.target instanceof Node && el.contains(ev.target)) return;
            setOpen(false);
        };

        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") setOpen(false);
        };

        window.addEventListener("mousedown", onMouseDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [open]);

    const Menu = React.useCallback(
        function Menu() {
            if (!open) return null;

            const pad = 8;
            const vw = typeof window !== "undefined" ? window.innerWidth : 9999;
            const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
            const maxW = 280;

            const x = Math.min(pos.x, vw - maxW - pad);
            const y = Math.min(pos.y, vh - 300 - pad);

            return (
                <div
                    ref={menuRef}
                    className="fixed z-[9999] min-w-[220px] max-w-[280px] rounded-md border bg-background shadow-lg overflow-hidden"
                    style={{ left: x, top: y }}
                    role="menu"
                >
                    <div className="py-1">
                        {items.map((it, idx) => {
                            if (it.kind === "sep") {
                                return <div key={`sep-${idx}`} className="my-1 h-px bg-border" />;
                            }
                            return (
                                <button
                                    key={`${it.label}-${idx}`}
                                    type="button"
                                    className={[
                                        "w-full flex items-center gap-2 px-3 py-2 text-sm text-left",
                                        it.disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/60 cursor-pointer",
                                    ].join(" ")}
                                    disabled={!!it.disabled}
                                    onClick={() => {
                                        if (it.disabled) return;
                                        setOpen(false);
                                        it.onClick();
                                    }}
                                >
                                    <span className="shrink-0">{it.icon ?? null}</span>
                                    <span className="truncate">{it.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        },
        [items, open, pos.x, pos.y]
    );

    return { show, close, Menu, isOpen: open };
}

/* ---------------------------------- Component ---------------------------------- */

type ClipboardState =
    | { mode: "copy" | "cut"; items: Array<{ path: string; isDir: boolean; name: string }> }
    | null;

export default function FileBrowserTab({
    deviceId,
    popout,
}: {
    deviceId: string;
    popout?: boolean;
}) {
    const [msg, setMsg] = React.useState<{ kind: "success" | "error" | "info"; text: string } | null>(
        null
    );

    const [drives, setDrives] = React.useState<DriveItem[]>([]);
    const [currentDir, setCurrentDir] = React.useState<string>("");
    const [selected, setSelected] = React.useState<{ path: string; isDir: boolean; name: string } | null>(
        null
    );

    // Tree state
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [children, setChildren] = React.useState<Record<string, FsItem[]>>({});
    const [loadingNode, setLoadingNode] = React.useState<Record<string, boolean>>({});

    // Right-panel list filter + upload state
    const [filter, setFilter] = React.useState("");
    const [uploading, setUploading] = React.useState(false);

    // Copy/Cut clipboard
    const [clipboard, setClipboard] = React.useState<ClipboardState>(null);

    // Move dialog
    const [moveOpen, setMoveOpen] = React.useState(false);
    const [moveTarget, setMoveTarget] = React.useState<{ path: string; isDir: boolean; name: string } | null>(
        null
    );
    const [moveDest, setMoveDest] = React.useState<string>("");

    // Rename dialog
    const [renameOpen, setRenameOpen] = React.useState(false);
    const [renameTarget, setRenameTarget] = React.useState<{ path: string; isDir: boolean; name: string } | null>(
        null
    );
    const [renameValue, setRenameValue] = React.useState("");

    // New folder dialog
    const [mkdirOpen, setMkdirOpen] = React.useState(false);
    const [mkdirParent, setMkdirParent] = React.useState<string>("");
    const [mkdirName, setMkdirName] = React.useState("");

    const cm = useContextMenu();

    const currentItems = React.useMemo(() => {
        const items = children[currentDir] ?? [];
        const q = filter.trim().toLowerCase();
        if (!q) return items;
        return items.filter((i) => String(i.name).toLowerCase().includes(q));
    }, [children, currentDir, filter]);

    const ensureListed = React.useCallback(
        async (path: string) => {
            const p = String(path ?? "").trim();
            if (!p) return;

            // undefined => not loaded yet; [] is valid loaded
            if (children[p] !== undefined) return;

            setLoadingNode((m) => ({ ...m, [p]: true }));
            setMsg(null);

            try {
                const res = await listDirectory(deviceId, p, false);
                const arr = sortFs(res.items ?? []);
                const realPath = String(res.path || p);

                setChildren((m) => ({ ...m, [realPath]: arr }));
                setCurrentDir((cur) => (samePath(cur, p) ? realPath : cur));
                setLoadingNode((m) => ({ ...m, [p]: false, [realPath]: false }));
            } catch (e: any) {
                setMsg({ kind: "error", text: String(e?.message || "Failed to list folder.") });
                setChildren((m) => ({ ...m, [p]: [] }));
                setLoadingNode((m) => ({ ...m, [p]: false }));
            }
        },
        [children, deviceId]
    );

    const toggleExpand = React.useCallback(
        async (dirPath: string) => {
            const willExpand = !expanded[dirPath];
            setExpanded((m) => ({ ...m, [dirPath]: !m[dirPath] }));
            if (willExpand) await ensureListed(dirPath);
        },
        [ensureListed, expanded]
    );

    const selectDir = React.useCallback(
        async (dirPath: string) => {
            const p = String(dirPath ?? "").trim();
            if (!p) return;
            setCurrentDir(p);
            setSelected({ path: p, isDir: true, name: p });
            setExpanded((m) => ({ ...m, [p]: true }));
            await ensureListed(p);
        },
        [ensureListed]
    );

    const refreshDir = React.useCallback(
        async (dirPath?: string) => {
            const p = String(dirPath ?? currentDir ?? "").trim();
            if (!p) return;

            setMsg(null);
            setChildren((m) => {
                const next = { ...m };
                delete next[p];
                return next;
            });

            await ensureListed(p);
        },
        [currentDir, ensureListed]
    );

    const loadRoots = React.useCallback(async () => {
        setMsg(null);
        try {
            const d = await listDrives(deviceId);

            if (!d.length) {
                setMsg({
                    kind: "info",
                    text:
                        'No roots returned. The backend should support GET /api/devices/:id/files/roots (job-based), and the agent should implement the "roots" FILE_OP.',
                });
                setDrives([]);
                return;
            }

            setDrives(d);

            if (!currentDir && d[0]?.path) {
                const root = d[0].path;
                setCurrentDir(root);
                setExpanded((m) => ({ ...m, [root]: true }));
                // prime cache marker
                setChildren((m) => (m[root] !== undefined ? m : { ...m, [root]: undefined as any }));
                await ensureListed(root);
            }
        } catch (e: any) {
            setMsg({ kind: "error", text: String(e?.message || "Failed to load roots.") });
            setDrives([]);
        }
    }, [currentDir, deviceId, ensureListed]);

    React.useEffect(() => {
        void loadRoots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deviceId]);

    // Ensure currentDir is loaded even if changed elsewhere
    React.useEffect(() => {
        if (!currentDir) return;
        void ensureListed(currentDir);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDir]);

    const downloadFile = React.useCallback(
        async (item: FsItem) => {
            if (item.isDir) return;
            setMsg(null);

            try {
                const { contentBase64 } = await readFileBase64(deviceId, item.path, 50 * 1024 * 1024);
                downloadBase64AsFile(contentBase64, item.name || baseName(item.path));
            } catch (e: any) {
                setMsg({ kind: "error", text: String(e?.message || "Download failed.") });
            }
        },
        [deviceId]
    );

    const onUpload = React.useCallback(
        async (file: File, destDir?: string) => {
            if (!file) return;
            const d = String(destDir ?? currentDir ?? "").trim();
            if (!d) return;

            setUploading(true);
            setMsg(null);

            try {
                const buf = await file.arrayBuffer();
                const b64 = toBase64FromArrayBuffer(buf);
                const destPath = joinPath(d, file.name);

                const jobRef = await fileWrite(deviceId, destPath, b64);
                await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Upload failed" });

                setMsg({ kind: "success", text: "Upload complete." });
                setUploading(false);
                await refreshDir(d);
            } catch (e: any) {
                setMsg({ kind: "error", text: String(e?.message || "Upload failed.") });
                setUploading(false);
            }
        },
        [currentDir, deviceId, refreshDir]
    );

    const doCopy = React.useCallback((it: { path: string; isDir: boolean; name: string }) => {
        setClipboard({ mode: "copy", items: [it] });
        setMsg({ kind: "success", text: `Copied: ${it.name}` });
    }, []);

    const doCut = React.useCallback((it: { path: string; isDir: boolean; name: string }) => {
        setClipboard({ mode: "cut", items: [it] });
        setMsg({ kind: "success", text: `Cut: ${it.name}` });
    }, []);

    const doPasteTo = React.useCallback(
        async (destDir: string) => {
            const d = String(destDir ?? "").trim();
            if (!clipboard?.items?.length || !d) return;

            setMsg(null);

            try {
                const op = clipboard.mode === "cut" ? "move" : "copy";

                for (const src of clipboard.items) {
                    const name = baseName(src.path);
                    const to = joinPath(d, name);

                    if (op === "move") {
                        const jobRef = await fileMove(deviceId, src.path, to);
                        await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Move failed" });
                    } else {
                        const jobRef = await fileCopy(deviceId, src.path, to, !!src.isDir);
                        await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Copy failed" });
                    }
                }

                setMsg({
                    kind: "success",
                    text: `${op === "move" ? "Moved" : "Copied"} ${clipboard.items.length} item(s).`,
                });

                await refreshDir(d);
                if (!samePath(currentDir, d)) await refreshDir(currentDir);

                if (clipboard.mode === "cut") setClipboard(null);
            } catch (e: any) {
                setMsg({ kind: "error", text: String(e?.message || "Paste failed.") });
            }
        },
        [clipboard, currentDir, deviceId, refreshDir]
    );

    const doDelete = React.useCallback(
        async (it: { path: string; isDir: boolean; name: string }) => {
            if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;

            setMsg(null);
            try {
                const jobRef = await fileDelete(deviceId, it.path, !!it.isDir);
                await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Delete failed" });

                setMsg({ kind: "success", text: `Deleted: ${it.name}` });
                await refreshDir(currentDir);
            } catch (e: any) {
                setMsg({ kind: "error", text: String(e?.message || "Delete failed.") });
            }
        },
        [currentDir, deviceId, refreshDir]
    );

    const openRename = React.useCallback((it: { path: string; isDir: boolean; name: string }) => {
        setRenameTarget(it);
        setRenameValue(it.name);
        setRenameOpen(true);
    }, []);

    const confirmRename = React.useCallback(async () => {
        const t = renameTarget;
        const next = renameValue.trim();
        if (!t || !next) return;

        setRenameOpen(false);
        setMsg(null);

        try {
            const parent = dirName(t.path);
            const to = joinPath(parent, next);

            const jobRef = await fileMove(deviceId, t.path, to);
            await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Rename failed" });

            setMsg({ kind: "success", text: `Renamed to: ${next}` });
            await refreshDir(parent.trim() ? parent : currentDir);
            if (!samePath(parent, currentDir)) await refreshDir(currentDir);
        } catch (e: any) {
            setMsg({ kind: "error", text: String(e?.message || "Rename failed.") });
        }
    }, [currentDir, deviceId, refreshDir, renameTarget, renameValue]);

    const openMkdir = React.useCallback((parentDir: string) => {
        setMkdirParent(parentDir);
        setMkdirName("");
        setMkdirOpen(true);
    }, []);

    const confirmMkdir = React.useCallback(async () => {
        const parent = mkdirParent.trim();
        const name = mkdirName.trim();
        if (!parent || !name) return;

        setMkdirOpen(false);
        setMsg(null);

        try {
            const path = joinPath(parent, name);
            const jobRef = await fileMkdir(deviceId, path);
            await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Create folder failed" });

            setMsg({ kind: "success", text: `Folder created: ${name}` });
            await refreshDir(parent);
        } catch (e: any) {
            setMsg({ kind: "error", text: String(e?.message || "Create folder failed.") });
        }
    }, [deviceId, mkdirName, mkdirParent, refreshDir]);

    const openMove = React.useCallback(
        (it: { path: string; isDir: boolean; name: string }) => {
            setMoveTarget(it);
            setMoveDest(currentDir || "");
            setMoveOpen(true);
        },
        [currentDir]
    );

    const confirmMove = React.useCallback(async () => {
        const t = moveTarget;
        const destDir = moveDest.trim();
        if (!t || !destDir) return;

        setMoveOpen(false);
        setMsg(null);

        try {
            const to = joinPath(destDir, baseName(t.path));
            const jobRef = await fileMove(deviceId, t.path, to);
            await runJob(jobRef, { timeoutMs: 180_000, pollMs: 800, failMessage: "Move failed" });

            setMsg({ kind: "success", text: `Moved: ${t.name}` });
            await refreshDir(destDir);
            await refreshDir(currentDir);

            setClipboard(null);
        } catch (e: any) {
            setMsg({ kind: "error", text: String(e?.message || "Move failed.") });
        }
    }, [currentDir, deviceId, moveDest, moveTarget, refreshDir]);

    // -------- Tree rendering --------
    const renderTreeNode = React.useCallback(
        (node: FsItem, depth: number) => {
            const isOpen = !!expanded[node.path];
            const isSelected = selected?.path ? samePath(selected.path, node.path) : false;
            const isLoading = !!loadingNode[node.path];
            const kids = children[node.path] ?? null;

            const menuItemsForDir = (dirPath: string, dirNameLabel: string): MenuItem[] => [
                { kind: "item", label: "Open", onClick: () => void selectDir(dirPath) },
                { kind: "sep" },
                {
                    kind: "item",
                    label: "Paste",
                    disabled: !clipboard?.items?.length,
                    icon: <ClipboardPaste className="h-4 w-4" />,
                    onClick: () => void doPasteTo(dirPath),
                },
                {
                    kind: "item",
                    label: "New Folder",
                    icon: <FolderPlus className="h-4 w-4" />,
                    onClick: () => openMkdir(dirPath),
                },
                { kind: "sep" },
                {
                    kind: "item",
                    label: "Rename",
                    icon: <Pencil className="h-4 w-4" />,
                    onClick: () => openRename({ path: dirPath, isDir: true, name: dirNameLabel }),
                },
                {
                    kind: "item",
                    label: "Delete",
                    icon: <Trash2 className="h-4 w-4" />,
                    onClick: () => void doDelete({ path: dirPath, isDir: true, name: dirNameLabel }),
                },
            ];

            return (
                <div key={node.path}>
                    <div
                        className={[
                            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm select-none",
                            isSelected ? "bg-muted" : "hover:bg-muted/40",
                        ].join(" ")}
                        style={{ paddingLeft: 8 + depth * 14 }}
                        onClick={() => {
                            setSelected({ path: node.path, isDir: true, name: node.name });
                            void selectDir(node.path);
                        }}
                        onContextMenu={(e) => cm.show(e, menuItemsForDir(node.path, node.name))}
                    >
                        <button
                            type="button"
                            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/60"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void toggleExpand(node.path);
                            }}
                            title={isOpen ? "Collapse" : "Expand"}
                        >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>

                        <Folder className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1 truncate" title={node.path}>
                            {node.name}
                        </div>

                        {isLoading ? <span className="text-[10px] text-muted-foreground">…</span> : null}
                    </div>

                    {isOpen ? (
                        <div>
                            {kids == null ? null : kids.filter((k) => k.isDir).map((k) => renderTreeNode(k, depth + 1))}
                            {kids != null && kids.filter((k) => k.isDir).length === 0 ? (
                                <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                                    (empty)
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            );
        },
        [
            children,
            clipboard?.items?.length,
            cm,
            doDelete,
            doPasteTo,
            expanded,
            loadingNode,
            openMkdir,
            openRename,
            selectDir,
            selected?.path,
            toggleExpand,
        ]
    );

    const treeRoots = React.useMemo(() => {
        return drives.map((d) => ({
            name: d.name,
            path: d.path,
            isDir: true,
        })) as FsItem[];
    }, [drives]);

    // Background menu for right pane (current folder)
    const showBackgroundMenu = React.useCallback(
        (e: React.MouseEvent) => {
            if (!currentDir) return;
            cm.show(e, [
                {
                    kind: "item",
                    label: "Paste into current folder",
                    disabled: !clipboard?.items?.length,
                    icon: <ClipboardPaste className="h-4 w-4" />,
                    onClick: () => void doPasteTo(currentDir),
                },
                { kind: "sep" },
                {
                    kind: "item",
                    label: "New Folder",
                    icon: <FolderPlus className="h-4 w-4" />,
                    onClick: () => openMkdir(currentDir),
                },
            ]);
        },
        [clipboard?.items?.length, cm, currentDir, doPasteTo, openMkdir]
    );

    // Per-row menu items
    const showItemMenu = React.useCallback(
        (e: React.MouseEvent, it: FsItem) => {
            const commonSelect = () => setSelected({ path: it.path, isDir: it.isDir, name: it.name });

            if (it.isDir) {
                cm.show(e, [
                    { kind: "item", label: "Open", onClick: () => void selectDir(it.path) },
                    { kind: "sep" },
                    {
                        kind: "item",
                        label: "Paste",
                        disabled: !clipboard?.items?.length,
                        icon: <ClipboardPaste className="h-4 w-4" />,
                        onClick: () => void doPasteTo(it.path),
                    },
                    {
                        kind: "item",
                        label: "New Folder",
                        icon: <FolderPlus className="h-4 w-4" />,
                        onClick: () => openMkdir(it.path),
                    },
                    { kind: "sep" },
                    {
                        kind: "item",
                        label: "Rename",
                        icon: <Pencil className="h-4 w-4" />,
                        onClick: () => openRename({ path: it.path, isDir: true, name: it.name }),
                    },
                    {
                        kind: "item",
                        label: "Delete",
                        icon: <Trash2 className="h-4 w-4" />,
                        onClick: () => void doDelete({ path: it.path, isDir: true, name: it.name }),
                    },
                    { kind: "sep" },
                    { kind: "item", label: "Select", onClick: commonSelect },
                ]);
                return;
            }

            cm.show(e, [
                {
                    kind: "item",
                    label: "Download",
                    icon: <Download className="h-4 w-4" />,
                    onClick: () => void downloadFile(it),
                },
                { kind: "sep" },
                {
                    kind: "item",
                    label: "Copy",
                    icon: <ClipboardCopy className="h-4 w-4" />,
                    onClick: () => doCopy({ path: it.path, isDir: false, name: it.name }),
                },
                {
                    kind: "item",
                    label: "Cut",
                    icon: <Scissors className="h-4 w-4" />,
                    onClick: () => doCut({ path: it.path, isDir: false, name: it.name }),
                },
                { kind: "sep" },
                {
                    kind: "item",
                    label: "Move…",
                    icon: <MoveRight className="h-4 w-4" />,
                    onClick: () => openMove({ path: it.path, isDir: false, name: it.name }),
                },
                {
                    kind: "item",
                    label: "Rename",
                    icon: <Pencil className="h-4 w-4" />,
                    onClick: () => openRename({ path: it.path, isDir: false, name: it.name }),
                },
                {
                    kind: "item",
                    label: "Delete",
                    icon: <Trash2 className="h-4 w-4" />,
                    onClick: () => void doDelete({ path: it.path, isDir: false, name: it.name }),
                },
                { kind: "sep" },
                { kind: "item", label: "Select", onClick: commonSelect },
            ]);
        },
        [
            clipboard?.items?.length,
            cm,
            doCopy,
            doCut,
            doDelete,
            doPasteTo,
            downloadFile,
            openMkdir,
            openMove,
            openRename,
            selectDir,
        ]
    );

    return (
        <div className="space-y-4">
            {/* Single menu portal */}
            <cm.Menu />

            {msg ? (
                <div
                    className={[
                        "rounded-md border px-3 py-2 text-sm",
                        msg.kind === "success"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : msg.kind === "error"
                                ? "border-red-200 bg-red-50 text-red-900"
                                : "border-border bg-muted/40 text-foreground",
                    ].join(" ")}
                    role="status"
                >
                    {msg.text}
                </div>
            ) : null}

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <CardTitle className="truncate">File Browser</CardTitle>
                            <div className="text-sm text-muted-foreground truncate">
                                Current: <span className="text-foreground">{currentDir || "—"}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void refreshDir(currentDir)}
                                className="gap-2"
                                disabled={!currentDir}
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh
                            </Button>

                            <label className="inline-flex items-center gap-2">
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) void onUpload(f, currentDir);
                                        e.currentTarget.value = "";
                                    }}
                                />
                                <Button variant="default" size="sm" className="gap-2" disabled={uploading || !currentDir}>
                                    <Upload className="h-4 w-4" />
                                    {uploading ? "Uploading…" : "Upload"}
                                </Button>
                            </label>

                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => currentDir && openMkdir(currentDir)}
                                disabled={!currentDir}
                            >
                                <FolderPlus className="h-4 w-4" />
                                New Folder
                            </Button>
                        </div>
                    </div>

                    <Separator className="mt-3" />

                    <div className="flex items-center gap-2 pt-3">
                        <div className="relative w-full sm:w-[320px]">
                            <Search className="h-4 w-4 text-muted-foreground absolute left-2 top-2.5" />
                            <Input
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder="Search current folder…"
                                className="pl-8"
                            />
                        </div>

                        <div className="flex-1" />

                        <div className="text-xs text-muted-foreground">
                            Clipboard:{" "}
                            {clipboard ? (
                                <span className="text-foreground">
                                    {clipboard.mode.toUpperCase()} · {clipboard.items.map((x) => x.name).join(", ")}
                                </span>
                            ) : (
                                <span>—</span>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        {/* Left: Tree */}
                        <div className="lg:col-span-4">
                            <div className="rounded-md border overflow-hidden">
                                <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                                    Directory Tree
                                </div>
                                <div className="h-[520px] overflow-auto">
                                    <div className="p-2">
                                        {treeRoots.length === 0 ? (
                                            <div className="px-2 py-3 text-sm text-muted-foreground">No roots found.</div>
                                        ) : (
                                            treeRoots.map((root) => renderTreeNode(root, 0))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: Current folder contents */}
                        <div className="lg:col-span-8">
                            <div className="rounded-md border overflow-hidden" onContextMenu={showBackgroundMenu}>
                                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                                    <div className="col-span-6">Name</div>
                                    <div className="col-span-2">Type</div>
                                    <div className="col-span-2 text-right">Size</div>
                                    <div className="col-span-2 text-right">Actions</div>
                                </div>

                                <div className="divide-y">
                                    {!currentDir ? (
                                        <div className="px-3 py-6 text-sm text-muted-foreground">Select a folder from the tree.</div>
                                    ) : loadingNode[currentDir] ? (
                                        <div className="px-3 py-6 text-sm text-muted-foreground">Loading…</div>
                                    ) : currentItems.length === 0 ? (
                                        <div className="px-3 py-6 text-sm text-muted-foreground">No files found.</div>
                                    ) : (
                                        currentItems.map((it) => {
                                            const isSel = selected?.path ? samePath(selected.path, it.path) : false;

                                            return (
                                                <div
                                                    key={it.path}
                                                    className={[
                                                        "grid grid-cols-12 gap-2 px-3 py-2 text-sm cursor-default",
                                                        isSel ? "bg-muted/40" : "hover:bg-muted/20",
                                                    ].join(" ")}
                                                    onClick={() => setSelected({ path: it.path, isDir: it.isDir, name: it.name })}
                                                    onDoubleClick={() => {
                                                        if (it.isDir) void selectDir(it.path);
                                                        else void downloadFile(it);
                                                    }}
                                                    onContextMenu={(e) => showItemMenu(e, it)}
                                                >
                                                    <div className="col-span-6 min-w-0 flex items-center gap-2">
                                                        {it.isDir ? (
                                                            <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        ) : (
                                                            <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        )}
                                                        <div className="truncate" title={it.name}>
                                                            {it.name}
                                                        </div>
                                                    </div>

                                                    <div className="col-span-2 text-muted-foreground">{it.isDir ? "Folder" : "File"}</div>

                                                    <div className="col-span-2 text-right text-muted-foreground">
                                                        {it.isDir ? "—" : fmtBytes(it.size ?? null)}
                                                    </div>

                                                    <div className="col-span-2 flex justify-end gap-2">
                                                        {it.isDir ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => void selectDir(it.path)}
                                                                className="h-8 px-2"
                                                                title="Open"
                                                            >
                                                                Open
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => void downloadFile(it)}
                                                                className="h-8 px-2 gap-1"
                                                                title="Download"
                                                            >
                                                                <Download className="h-4 w-4" />
                                                                Download
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {popout ? (
                                <div className="pt-3 text-xs text-muted-foreground">
                                    Popout mode: same component, same APIs — just a different shell.
                                </div>
                            ) : null}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* MOVE DIALOG */}
            <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Move</DialogTitle>
                        <DialogDescription>
                            Choose a destination folder for{" "}
                            <span className="text-foreground font-medium">{moveTarget?.name ?? "…"}</span>.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-md border overflow-hidden">
                            <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">Destination</div>
                            <div className="h-[360px] overflow-auto">
                                <div className="p-2 space-y-1">
                                    {treeRoots.map((root) => (
                                        <div key={root.path} className="space-y-1">
                                            <div
                                                className={[
                                                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none hover:bg-muted/40 cursor-pointer",
                                                    samePath(moveDest, root.path) ? "bg-muted" : "",
                                                ].join(" ")}
                                                onClick={() => setMoveDest(root.path)}
                                                title={root.path}
                                            >
                                                <Folder className="h-4 w-4 text-muted-foreground" />
                                                <div className="truncate">{root.name}</div>
                                            </div>

                                            {(children[root.path] ?? [])
                                                .filter((x) => x.isDir)
                                                .map((d) => (
                                                    <div
                                                        key={d.path}
                                                        className={[
                                                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none hover:bg-muted/40 cursor-pointer",
                                                            samePath(moveDest, d.path) ? "bg-muted" : "",
                                                        ].join(" ")}
                                                        style={{ paddingLeft: 22 }}
                                                        onClick={() => setMoveDest(d.path)}
                                                        title={d.path}
                                                    >
                                                        <Folder className="h-4 w-4 text-muted-foreground" />
                                                        <div className="truncate">{d.name}</div>
                                                    </div>
                                                ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-medium">Destination path</div>
                            <Input value={moveDest} onChange={(e) => setMoveDest(e.target.value)} placeholder="Pick a folder…" />
                            <div className="text-xs text-muted-foreground">
                                Tip: Expand folders in the main tree first for deeper destinations, or paste a path here.
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMoveOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void confirmMove()} disabled={!moveTarget || !moveDest.trim()}>
                            Move
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* RENAME DIALOG */}
            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename</DialogTitle>
                        <DialogDescription>
                            Rename <span className="text-foreground font-medium">{renameTarget?.name ?? "…"}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <div className="text-sm font-medium">New name</div>
                        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void confirmRename()} disabled={!renameTarget || !renameValue.trim()}>
                            Rename
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* NEW FOLDER DIALOG */}
            <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>New Folder</DialogTitle>
                        <DialogDescription>
                            Create a folder inside: <span className="text-foreground">{mkdirParent}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <div className="text-sm font-medium">Folder name</div>
                        <Input value={mkdirName} onChange={(e) => setMkdirName(e.target.value)} placeholder="New folder" />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMkdirOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={() => void confirmMkdir()} disabled={!mkdirParent.trim() || !mkdirName.trim()}>
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
