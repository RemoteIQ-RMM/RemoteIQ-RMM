// components/perm-gate.tsx
"use client";

import * as React from "react";
import { useMe } from "@/lib/use-me";
import { hasPerm } from "@/lib/permissions";
import NoPermission from "@/components/no-permission";

export default function PermGate({
    require,
    children,
    title,
    message,
}: {
    require?: string | string[];
    children: React.ReactNode;
    title?: string;
    message?: string;
}) {
    const { permissions, loading } = useMe();

    if (loading) {
        // Keep layout stable; you can swap for skeletons later
        return <div className="h-24" />;
    }

    const ok = hasPerm(permissions, require);
    if (!ok) {
        return (
            <NoPermission
                title={title ?? "No permission"}
                message={message ?? "You don’t have permission to view this content."}
                required={require}
            />
        );
    }

    return <>{children}</>;
}
