"use client";

import * as React from "react";
import { Terminal, Loader2, Trash2, CornerUpLeft, Copy } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useJobRun } from "@/lib/use-job-run";

type Props = {
    deviceId: string;
    popout?: boolean;
};

function formatStatus(s: string | null) {
    if (!s) return "Idle";
    if (s === "queued") return "Queued";
    if (s === "running") return "Running";
    if (s === "succeeded") return "Succeeded";
    if (s === "failed") return "Failed";
    return s;
}

export default function RemoteShellTab({ deviceId, popout }: Props) {
    const [command, setCommand] = React.useState("");
    const [history, setHistory] = React.useState<string[]>([]);
    const historyIdx = React.useRef<number>(-1);

    const { status, progress, log, error, start } = useJobRun();
    const busy = status === "queued" || status === "running";

    const canRun = !!deviceId && !!command.trim() && !busy;

    async function runCommand() {
        const cmd = command.trim();
        if (!cmd || busy) return;

        // Push into local history
        setHistory((h) => [...h, cmd].slice(-50));
        historyIdx.current = -1;

        // Kick off job
        await start({
            deviceId,
            shell: "powershell",
            timeoutSec: 120,
            script: cmd,
        });

        setCommand("");
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            e.preventDefault();
            void runCommand();
            return;
        }

        // Command history
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!history.length) return;

            if (historyIdx.current === -1) historyIdx.current = history.length - 1;
            else historyIdx.current = Math.max(0, historyIdx.current - 1);

            setCommand(history[historyIdx.current] ?? "");
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!history.length) return;

            if (historyIdx.current === -1) return;

            historyIdx.current = Math.min(history.length - 1, historyIdx.current + 1);
            setCommand(history[historyIdx.current] ?? "");
            return;
        }
    }

    async function copyOutput() {
        try {
            await navigator.clipboard.writeText(log || "");
        } catch {
            // ignore
        }
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                        <Terminal className="h-4 w-4" />
                        Remote Shell
                    </CardTitle>
                    <CardDescription>
                        Run one-off PowerShell commands on this endpoint. Output appears below.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="flex-1">
                            <Input
                                value={command}
                                onChange={(e) => setCommand(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder="Example: whoami"
                                disabled={!deviceId || busy}
                            />
                            <div className="mt-1 text-xs text-muted-foreground">
                                Tip: Press <span className="font-medium">Enter</span> to run. Use{" "}
                                <span className="font-medium">↑/↓</span> for history.
                            </div>
                        </div>

                        <div className="flex gap-2 sm:justify-end">
                            <Button onClick={runCommand} disabled={!canRun} className="gap-2">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerUpLeft className="h-4 w-4" />}
                                {busy ? `Running… ${progress ?? 0}%` : "Run"}
                            </Button>

                            <Button
                                variant="outline"
                                onClick={() => window.location.reload()}
                                disabled={busy}
                                title="Clear output (reloads view)"
                                className="gap-2"
                            >
                                <Trash2 className="h-4 w-4" />
                                Clear
                            </Button>

                            <Button
                                variant="outline"
                                onClick={copyOutput}
                                disabled={!log}
                                title="Copy output"
                                className="gap-2"
                            >
                                <Copy className="h-4 w-4" />
                                Copy
                            </Button>
                        </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between text-sm">
                        <div className="text-muted-foreground">
                            Status: <span className="text-foreground font-medium">{formatStatus(status)}</span>
                            {busy ? <span className="text-muted-foreground"> • {progress ?? 0}%</span> : null}
                        </div>

                        {popout ? (
                            <div className="text-xs text-muted-foreground">Popout mode</div>
                        ) : null}
                    </div>

                    {error ? (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                            {error}
                        </div>
                    ) : null}

                    <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap h-[520px] overflow-auto">
                        {log || "Output will appear here…"}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
