"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

type NewEndpointModalProps = {
    disabled?: boolean;
};

export function NewEndpointModal({ disabled }: NewEndpointModalProps) {
    const [open, setOpen] = React.useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="default" size="sm" disabled={disabled}>
                    New Endpoint
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>New Endpoint</DialogTitle>
                    <DialogDescription>
                        Generate a time-limited installer for a specific client and site.
                    </DialogDescription>
                </DialogHeader>

                {/* Scaffold: we'll build the full form next */}
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                    Coming next:
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                        <li>Client selector</li>
                        <li>Site selector (filtered by client)</li>
                        <li>OS selector (Windows / Linux / macOS)</li>
                        <li>Generate DeviceId button</li>
                        <li>Alias field (tech-set)</li>
                        <li>Expiration (minutes)</li>
                        <li>Generate installer command/download</li>
                    </ul>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
