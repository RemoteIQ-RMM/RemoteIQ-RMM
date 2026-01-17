// components/no-permission.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export default function NoPermission({
    title = "No permission",
    message = "You don’t have permission to view this content.",
    required,
}: {
    title?: string;
    message?: string;
    required?: string | string[];
}) {
    const req = Array.isArray(required) ? required : required ? [required] : [];
    return (
        <Card className="p-6">
            <div className="flex items-start gap-3">
                <div className="mt-0.5">
                    <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{message}</div>
                    {req.length > 0 ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                            Required permission{req.length > 1 ? "s" : ""}:{" "}
                            <span className="font-mono">{req.join(", ")}</span>
                        </div>
                    ) : null}
                </div>
            </div>
        </Card>
    );
}
