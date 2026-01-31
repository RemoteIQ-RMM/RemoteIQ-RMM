// components/remote-desktop-panel.tsx
"use client";

import * as React from "react";
import { Copy, Monitor, RefreshCw, Trash2, ExternalLink } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type RemoteDesktopPanelProps = {
    deviceId: string;
    agentUuid?: string | null;
    popout?: boolean;
};

type ApiSession = {
    sessionId: string;
    agentUuid: string;
    state: "opening" | "ready" | "error" | "closed" | string;
    createdAt: number;
    lastActivityAt: number;
    localPort: number;
    error?: string;
    target?: { host: string; port: number };
};

type ApiErrorShape = {
    message?: string | string[];
    error?: string;
    statusCode?: number;
};

type SessionsResponse = {
    ok: boolean;
    agents?: string[];
    sessions?: ApiSession[];
} & ApiErrorShape;

type CreateSessionResponse = {
    ok: boolean;
    sessionId: string;
    host: string;
    port: number;
    target?: { host: string; port: number };
} & ApiErrorShape;

async function safeJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

function extractErrorMessage(body: any, fallback: string) {
    if (!body) return fallback;

    const msg = body?.message;
    if (Array.isArray(msg)) return msg.filter(Boolean).join(", ") || fallback;
    if (typeof msg === "string" && msg.trim()) return msg.trim();

    const err = body?.error;
    if (typeof err === "string" && err.trim()) return err.trim();

    return fallback;
}

/**
 * Opens the native Windows RDP tool from the browser by navigating to a backend-served .rdp file.
 * Your backend should serve this route as application/x-rdp (or text/plain) with a Content-Disposition filename.
 *
 * Example backend route:
 *   GET /api/remote-desktop/sessions/:sessionId/rdp
 */
function openNativeRdp(sessionId: string) {
    const url = `/api/remote-desktop/sessions/${encodeURIComponent(sessionId)}/rdp`;
    // New window/tab so it feels like “launching” the session from UI
    window.open(url, "_blank", "noopener,noreferrer");
}

function mstscCommand(host: string, port: number) {
    return `mstsc /v:${host}:${port}`;
}

export default function RemoteDesktopPanel({ deviceId, agentUuid, popout }: RemoteDesktopPanelProps) {
    const [loading, setLoading] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const [autoClose, setAutoClose] = React.useState(true);

    const [sessions, setSessions] = React.useState<ApiSession[]>([]);
    const [connectedAgents, setConnectedAgents] = React.useState<string[]>([]);

    // Track if THIS UI instance created a session, so we can auto-close on leave if desired.
    const createdSessionIdRef = React.useRef<string | null>(null);

    const mySession = React.useMemo(() => {
        if (!agentUuid) return null;
        return sessions.find((s) => String(s.agentUuid) === String(agentUuid)) ?? null;
    }, [agentUuid, sessions]);

    const fetchSessions = React.useCallback(async () => {
        setRefreshing(true);
        setError(null);

        try {
            const res = await fetch("/api/remote-desktop/sessions", {
                method: "GET",
                credentials: "include",
            });

            const body = (await safeJson(res)) as SessionsResponse | null;

            if (!res.ok) {
                setError(extractErrorMessage(body, `Failed to load sessions (${res.status})`));
                return;
            }

            setConnectedAgents(Array.isArray(body?.agents) ? body!.agents! : []);
            setSessions(Array.isArray(body?.sessions) ? body!.sessions! : []);
        } catch (e: any) {
            setError(String(e?.message || e || "Failed to load sessions"));
        } finally {
            setRefreshing(false);
        }
    }, []);

    React.useEffect(() => {
        void fetchSessions();

        const t = setInterval(() => {
            void fetchSessions();
        }, 3000);

        return () => clearInterval(t);
    }, [fetchSessions]);

    // Best-effort auto-close on unmount (only if we created it here)
    React.useEffect(() => {
        return () => {
            const sid = createdSessionIdRef.current;
            if (!sid) return;
            if (!autoClose) return;

            try {
                fetch(`/api/remote-desktop/sessions/${encodeURIComponent(sid)}`, {
                    method: "DELETE",
                    credentials: "include",
                }).catch(() => { });
            } catch {
                // ignore
            }
        };
    }, [autoClose]);

    const copy = React.useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // ignore
        }
    }, []);

    const startSessionAndOpenRdp = React.useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            // Backend rule: EXACTLY ONE of deviceId or agentUuid.
            // Prefer agentUuid when available; fall back to deviceId.
            const payload = agentUuid ? { agentUuid: String(agentUuid) } : { deviceId: String(deviceId) };

            if (!payload.agentUuid && !payload.deviceId) {
                setError("Missing deviceId/agentUuid, so Remote Desktop can’t start.");
                return;
            }

            const res = await fetch("/api/remote-desktop/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(payload),
            });

            const body = (await safeJson(res)) as CreateSessionResponse | null;

            if (!res.ok) {
                setError(extractErrorMessage(body, `Failed to start session (${res.status})`));
                return;
            }

            const sid = String(body?.sessionId || "");
            if (!sid) {
                setError("Session started but the server did not return a sessionId.");
                return;
            }

            createdSessionIdRef.current = sid;

            // Refresh UI state, then launch native RDP via .rdp file in a new browser tab/window.
            await fetchSessions();
            openNativeRdp(sid);
        } catch (e: any) {
            setError(String(e?.message || e || "Failed to start session"));
        } finally {
            setLoading(false);
        }
    }, [agentUuid, deviceId, fetchSessions]);

    const closeSession = React.useCallback(
        async (sessionId: string) => {
            setLoading(true);
            setError(null);

            try {
                const res = await fetch(`/api/remote-desktop/sessions/${encodeURIComponent(sessionId)}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                const body = await safeJson(res);

                if (!res.ok) {
                    setError(extractErrorMessage(body, `Failed to close session (${res.status})`));
                    return;
                }

                if (createdSessionIdRef.current === sessionId) {
                    createdSessionIdRef.current = null;
                }

                await fetchSessions();
            } catch (e: any) {
                setError(String(e?.message || e || "Failed to close session"));
            } finally {
                setLoading(false);
            }
        },
        [fetchSessions]
    );

    const agentConnected = React.useMemo(() => {
        if (!agentUuid) return false;
        return connectedAgents.includes(String(agentUuid));
    }, [agentUuid, connectedAgents]);

    // Still shown as a fallback/debug tip
    const cmd = mySession ? mstscCommand("127.0.0.1", mySession.localPort) : "";

    return (
        <div className="h-full min-h-0">
            <Card className="h-full flex flex-col min-h-0">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2">
                            <Monitor className="h-5 w-5" />
                            Remote Desktop
                        </CardTitle>
                        <CardDescription className="truncate">
                            Starts a local tunnel and launches the native Windows Remote Desktop app.
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            variant="outline"
                            onClick={fetchSessions}
                            disabled={refreshing}
                            className="gap-2"
                            title="Refresh"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </Button>

                        {mySession ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => openNativeRdp(mySession.sessionId)}
                                    disabled={loading}
                                    className="gap-2"
                                    title="Open native RDP"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    Open RDP
                                </Button>

                                <Button
                                    variant="destructive"
                                    onClick={() => closeSession(mySession.sessionId)}
                                    disabled={loading}
                                    className="gap-2"
                                    title="Close session"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Close
                                </Button>
                            </>
                        ) : (
                            <Button
                                onClick={startSessionAndOpenRdp}
                                disabled={loading || (!agentUuid && !deviceId)}
                                className="gap-2"
                                title="Start session and open the native RDP app"
                            >
                                Start Session
                            </Button>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="flex-1 min-h-0 space-y-4">
                    {error ? (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                            {error}
                        </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Agent</div>
                            <div className="mt-1 text-sm">
                                <div className="truncate">
                                    <span className="font-medium">agentUuid:</span>{" "}
                                    <code className="text-xs">{agentUuid ?? "—"}</code>
                                </div>
                                <div className="mt-1">
                                    <span className="font-medium">Connected:</span>{" "}
                                    <span className={agentConnected ? "text-emerald-600" : "text-muted-foreground"}>
                                        {agentConnected ? "Yes" : "No"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Session</div>
                            <div className="mt-1 text-sm">
                                {mySession ? (
                                    <>
                                        <div className="truncate">
                                            <span className="font-medium">sessionId:</span>{" "}
                                            <code className="text-xs">{mySession.sessionId}</code>
                                        </div>
                                        <div className="mt-1">
                                            <span className="font-medium">state:</span>{" "}
                                            <span className={mySession.state === "ready" ? "text-emerald-600" : "text-muted-foreground"}>
                                                {mySession.state}
                                            </span>
                                        </div>
                                        <div className="mt-1">
                                            <span className="font-medium">localPort:</span>{" "}
                                            <code className="text-xs">{mySession.localPort}</code>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-muted-foreground">No active session for this agent.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium">Fallback command (debug)</div>
                                <div className="text-xs text-muted-foreground">
                                    If your browser blocks the .rdp launch, you can still copy/paste this command.
                                </div>
                            </div>

                            <div className="flex items-center space-x-2">
                                <Switch id="autoclose" checked={autoClose} onCheckedChange={(v) => setAutoClose(Boolean(v))} />
                                <Label htmlFor="autoclose" className="text-xs text-muted-foreground">
                                    Auto-close on leave
                                </Label>
                            </div>
                        </div>

                        <div className="rounded-md border bg-muted/20 p-3 flex items-center justify-between gap-3">
                            <code className="text-xs break-all">{mySession ? cmd : "Start a session to get a command…"}</code>

                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!mySession}
                                onClick={() => mySession && copy(cmd)}
                                className="gap-2 shrink-0"
                                title="Copy command"
                            >
                                <Copy className="h-4 w-4" />
                                Copy
                            </Button>
                        </div>

                        {mySession ? (
                            <div className="text-xs text-muted-foreground">
                                Primary flow: click <span className="font-medium">Open RDP</span> to launch the native RDP app in a new
                                browser window/tab via a <code className="text-xs">.rdp</code> file.
                            </div>
                        ) : null}
                    </div>

                    {popout ? null : (
                        <div className="text-xs text-muted-foreground">
                            Note: Browsers can’t “embed” MSTSC; this launches it by opening a server-generated <code className="text-xs">.rdp</code>{" "}
                            file in a new tab/window.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
