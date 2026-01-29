// remoteiq-frontend/components/remote-shell-panel.tsx
"use client";

import * as React from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Props = {
    deviceId: string;
    agentUuid?: string;
    popout?: boolean;
};

type Status = "disconnected" | "connecting" | "waiting_for_agent" | "connected";
type RunAs = "system" | "user";

type ServerToUi =
    | {
        type: "status";
        status: "connected" | "waiting_for_agent" | "agent_connected" | "agent_disconnected";
        agentUuid: string;
    }
    | { type: "session"; sessionId: string; agentUuid: string }
    | { type: "data"; sessionId: string; data: string }
    | { type: "exit"; sessionId: string; code?: number; signal?: string; message?: string }
    | { type: "error"; message: string };

function getWsBase(): string {
    const env = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_BASE) || "";
    if (env) return env.replace(/\/+$/, "");

    if (typeof window !== "undefined") {
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        return `${scheme}://${window.location.host}/ws`;
    }
    return "";
}

function safeParse(raw: any): any | null {
    try {
        const text = typeof raw === "string" ? raw : raw?.toString ? raw.toString("utf8") : "";
        if (!text) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function friendlyError(m: string): string {
    if (!m) return "Unknown error";
    if (m.includes("No active console session")) return "No interactive user is logged in right now.";
    if (m.includes("WTSQueryUserToken"))
        return "Unable to run as logged-in user (token query failed). Try SYSTEM, or ensure a user is logged in.";
    return m;
}

export default function RemoteShellPanel({ deviceId, agentUuid, popout }: Props) {
    const [status, setStatus] = React.useState<Status>("disconnected");
    const [sessionId, setSessionId] = React.useState<string | null>(null);
    const [lastError, setLastError] = React.useState<string | null>(null);

    // default SYSTEM
    const [runAs, setRunAs] = React.useState<RunAs>("system");

    const wsRef = React.useRef<WebSocket | null>(null);

    const termRef = React.useRef<Terminal | null>(null);
    const fitRef = React.useRef<FitAddon | null>(null);
    const termHostRef = React.useRef<HTMLDivElement | null>(null);

    // Prevent double-open per socket connection
    const openSentRef = React.useRef(false);

    // Prevent any implicit re-open after user clicks Disconnect/Cancel
    const manualDisconnectRef = React.useRef(false);

    // Keep a ref for session id to avoid stale closures
    const sessionIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    const agentId = (agentUuid || "").trim();

    const termWrite = React.useCallback((s: string) => {
        termRef.current?.write(s);
    }, []);

    const termReset = React.useCallback((banner?: string) => {
        const t = termRef.current;
        if (!t) return;
        t.reset();
        if (banner) t.writeln(banner);
    }, []);

    const fitNow = React.useCallback(() => {
        try {
            fitRef.current?.fit();
        } catch {
            // ignore
        }
    }, []);

    const send = React.useCallback((payload: any) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(payload));
    }, []);

    const sendResize = React.useCallback(() => {
        const t = termRef.current;
        const sid = sessionIdRef.current;
        if (!t || !sid) return;
        send({ type: "resize", sessionId: sid, cols: t.cols, rows: t.rows });
    }, [send]);

    const hardCloseSocket = React.useCallback(() => {
        const ws = wsRef.current;
        if (!ws) return;
        try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.close();
        } catch {
            // ignore
        }
        wsRef.current = null;
    }, []);

    const disconnect = React.useCallback(() => {
        // user explicitly disconnected/canceled
        manualDisconnectRef.current = true;

        // prevent any further opens on this socket
        openSentRef.current = true;

        // best-effort tell server to close session first (if any)
        const sid = sessionIdRef.current;
        if (sid) {
            try {
                send({ type: "close", sessionId: sid });
            } catch {
                // ignore
            }
        }

        setStatus("disconnected");
        setSessionId(null);
        setLastError(null);

        hardCloseSocket();
        termWrite(`\r\n[disconnected]\r\n`);
    }, [hardCloseSocket, send, termWrite]);

    // Create terminal once
    React.useEffect(() => {
        if (!termHostRef.current) return;
        if (termRef.current) return;

        const term = new Terminal({
            convertEol: true,
            cursorBlink: true,
            scrollback: 5000,
            fontSize: 13,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);

        term.open(termHostRef.current);

        termRef.current = term;
        fitRef.current = fit;

        fitNow();
        term.writeln("Ready. Click Connect to start a shell session.");

        return () => {
            try {
                term.dispose();
            } catch { }
            termRef.current = null;
            fitRef.current = null;
        };
    }, [fitNow]);

    const bindTerminalInputOnce = React.useCallback(() => {
        const t = termRef.current as any;
        if (!t) return;

        if (t.__remoteShellBound) return;
        t.__remoteShellBound = true;

        (termRef.current as Terminal).onData((data) => {
            const sid = (termRef.current as any)?.__sessionId ?? null;
            if (!sid) return;
            send({ type: "input", sessionId: sid, data });
        });
    }, [send]);

    const trySendOpen = React.useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (manualDisconnectRef.current) return;

        if (openSentRef.current) return;
        openSentRef.current = true;

        const t = termRef.current;
        send({
            type: "open",
            cols: t?.cols ?? 120,
            rows: t?.rows ?? 30,
            runAs,
        });
    }, [runAs, send]);

    const connect = React.useCallback(() => {
        setLastError(null);
        setSessionId(null);
        setStatus("connecting");

        // allow open for this connection attempt
        openSentRef.current = false;
        manualDisconnectRef.current = false;

        const base = getWsBase();
        if (!base) {
            setStatus("disconnected");
            setLastError("Missing NEXT_PUBLIC_WS_BASE (or cannot derive WS base URL).");
            termReset("Error: missing WS base URL.");
            return;
        }
        if (!agentId) {
            setStatus("disconnected");
            setLastError("Missing agentUuid for this device.");
            termReset("Error: missing agentUuid.");
            return;
        }

        fitNow();

        const url = `${base}/shell?role=ui&agentUuid=${encodeURIComponent(agentId)}`;

        hardCloseSocket();
        termReset("Connecting...");

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            // Wait for server status, but we can attempt open immediately too
            setStatus("connected");
            trySendOpen();
        };

        ws.onmessage = (ev) => {
            const msg = safeParse(ev.data) as ServerToUi | null;
            if (!msg) return;

            if (msg.type === "status") {
                if (msg.status === "waiting_for_agent") {
                    setStatus("waiting_for_agent");
                    setSessionId(null);

                    // ok to reset before a session exists
                    termReset("Waiting for agent...");
                    return;
                }

                if (msg.status === "agent_disconnected") {
                    setStatus("waiting_for_agent");
                    setSessionId(null);

                    // ok to reset before a session exists
                    termReset("Agent disconnected. Waiting for agent...");
                    return;
                }

                if (msg.status === "agent_connected" || msg.status === "connected") {
                    if (manualDisconnectRef.current) return; // user clicked Disconnect/Cancel
                    setStatus("connected");
                    trySendOpen();
                    return;
                }

                return;
            }

            if (msg.type === "session") {
                setSessionId(msg.sessionId);

                fitNow();

                // IMPORTANT: do NOT termReset here (prevents double prompt)
                termWrite(
                    `\r\n[connected] Session ${msg.sessionId} (${runAs === "user" ? "User" : "SYSTEM"})\r\n`
                );

                bindTerminalInputOnce();
                (termRef.current as any).__sessionId = msg.sessionId;

                sendResize();
                return;
            }

            if (msg.type === "data") {
                termWrite(msg.data || "");
                return;
            }

            if (msg.type === "exit") {
                setSessionId(null);
                (termRef.current as any).__sessionId = null;
                termWrite(`\r\n\r\n[session ended] ${msg.message ?? ""}\r\n`);
                return;
            }

            if (msg.type === "error") {
                const m = friendlyError(msg.message || "Unknown error");
                setLastError(m);
                termWrite(`\r\n[error] ${m}\r\n`);
                return;
            }
        };

        ws.onerror = () => {
            setLastError("WebSocket error");
        };

        ws.onclose = () => {
            // reflect disconnected; do NOT auto-reconnect.
            setStatus("disconnected");
            setSessionId(null);
            (termRef.current as any).__sessionId = null;
            termWrite(`\r\n[disconnected]\r\n`);
        };
    }, [
        agentId,
        bindTerminalInputOnce,
        fitNow,
        hardCloseSocket,
        runAs,
        sendResize,
        termReset,
        termWrite,
        trySendOpen,
    ]);

    // resize => fit terminal AND inform agent
    React.useEffect(() => {
        const onResize = () => {
            fitNow();
            sendResize();
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [fitNow, sendResize]);

    const onCtrlC = React.useCallback(() => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        send({ type: "input", sessionId: sid, data: "\x03" });
    }, [send]);

    const prettyStatus =
        status === "connected"
            ? sessionId
                ? "Connected"
                : "Connected (opening session...)"
            : status === "waiting_for_agent"
                ? "Waiting for agent"
                : status === "connecting"
                    ? "Connecting"
                    : "Disconnected";

    const canConnect = status === "disconnected" && !sessionId;
    const canUseSessionControls = !!sessionId;

    const canCancelConnection =
        !sessionId && (status === "connecting" || status === "waiting_for_agent" || status === "connected");

    return (
        <Card className={popout ? "w-full h-full flex flex-col" : "w-full h-full flex flex-col"}>
            <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="truncate">Remote Shell</CardTitle>
                        <CardDescription className="truncate">
                            Device: <code className="text-xs">{deviceId}</code> · Agent:{" "}
                            <code className="text-xs">{agentId || "—"}</code>
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" onClick={connect} disabled={!canConnect}>
                            Connect
                        </Button>

                        <Button variant="outline" onClick={onCtrlC} disabled={!canUseSessionControls}>
                            Ctrl+C
                        </Button>

                        {canUseSessionControls ? (
                            <Button variant="destructive" onClick={disconnect}>
                                Disconnect
                            </Button>
                        ) : (
                            <Button variant="outline" onClick={disconnect} disabled={!canCancelConnection}>
                                Cancel
                            </Button>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                        <span className="text-muted-foreground">Status: </span>
                        <span className="font-medium">{prettyStatus}</span>
                        {lastError ? (
                            <span className="ml-2 text-destructive">
                                {" · "}
                                {lastError}
                            </span>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                        <Switch
                            id="run-as-user"
                            checked={runAs === "user"}
                            onCheckedChange={(v) => setRunAs(v ? "user" : "system")}
                            disabled={status !== "disconnected"} // only change before connecting
                        />
                        <Label htmlFor="run-as-user" className="text-sm">
                            Run as logged-in user
                        </Label>
                    </div>
                </div>

                <Separator />
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-3 min-h-0">
                <div className="flex-1 min-h-0 rounded-md border bg-background overflow-hidden">
                    <div ref={termHostRef} className="h-full w-full" />
                </div>

                <div className="text-xs text-muted-foreground">
                    Interactive PowerShell session ({runAs === "user" ? "User" : "SYSTEM"}). Output streams live
                    from the agent.
                </div>
            </CardContent>
        </Card>
    );
}
