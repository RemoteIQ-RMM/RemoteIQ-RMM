// components/remote-tab.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Monitor, Terminal, FileText, ExternalLink } from "lucide-react";

type RemoteTabProps = {
    /** The current device id (uuid). If omitted, actions will be disabled. */
    deviceId?: string;
};

type RemoteToolCardProps = {
    icon: React.ElementType;
    title: string;
    description: string;
    actionText: string;
    onAction?: () => void;
    disabled?: boolean;
    secondaryActionText?: string;
    onSecondaryAction?: () => void;
};

function RemoteToolCard({
    icon,
    title,
    description,
    actionText,
    onAction,
    disabled,
    secondaryActionText,
    onSecondaryAction,
}: RemoteToolCardProps) {
    const Icon = icon;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-medium">{title}</CardTitle>
                <Icon className="h-6 w-6 text-muted-foreground" />
            </CardHeader>

            <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{description}</p>

                <div className="flex gap-2">
                    <Button className="w-full" onClick={onAction} disabled={disabled}>
                        {actionText}
                    </Button>

                    {secondaryActionText ? (
                        <Button
                            variant="outline"
                            onClick={onSecondaryAction}
                            disabled={disabled}
                            className="shrink-0"
                            title={secondaryActionText}
                        >
                            <ExternalLink className="h-4 w-4" />
                        </Button>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}

export default function RemoteTab({ deviceId }: RemoteTabProps) {
    const router = useRouter();
    const disabled = !deviceId;

    const openInDashboard = (tool: "remote-desktop" | "remote-shell" | "file-browser") => {
        if (!deviceId) return;

        // Embed inside the device dashboard view.
        // Your device page can read this query param and render the tool panel.
        router.push(`/devices/${encodeURIComponent(deviceId)}?tool=${encodeURIComponent(tool)}`);
    };

    const popout = (tool: "remote-desktop" | "remote-shell" | "file-browser") => {
        if (!deviceId) return;

        // Same view, different shell. popout=1 can hide sidebar/topbar.
        const url = `/devices/${encodeURIComponent(deviceId)}?tool=${encodeURIComponent(tool)}&popout=1`;
        window.open(url, "_blank", "noopener,noreferrer,width=1280,height=800");
    };

    return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <RemoteToolCard
                icon={Monitor}
                title="Remote Desktop"
                description="Start an interactive remote desktop session. View and control the user's screen in real-time."
                actionText="Start Session"
                onAction={() => openInDashboard("remote-desktop")}
                secondaryActionText="Pop out"
                onSecondaryAction={() => popout("remote-desktop")}
                disabled={disabled}
            />

            <RemoteToolCard
                icon={Terminal}
                title="Remote Shell"
                description="Open a secure PowerShell session directly on the endpoint for advanced command-line tasks."
                actionText="Open Shell"
                onAction={() => openInDashboard("remote-shell")}
                secondaryActionText="Pop out"
                onSecondaryAction={() => popout("remote-shell")}
                disabled={disabled}
            />

            <RemoteToolCard
                icon={FileText}
                title="File Browser"
                description="Securely browse, upload, and download files from the endpoint's filesystem."
                actionText="Browse Files"
                onAction={() => openInDashboard("file-browser")}
                secondaryActionText="Pop out"
                onSecondaryAction={() => popout("file-browser")}
                disabled={disabled}
            />
        </div>
    );
}
