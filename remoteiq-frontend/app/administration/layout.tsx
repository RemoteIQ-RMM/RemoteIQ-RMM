// app/administration/layout.tsx
import * as React from "react";
import AdminGate from "./AdminGate";

export const metadata = {
    title: "Administration • RemoteIQ",
};

export default function AdministrationLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Keep this file server-only so `metadata` is allowed.
    // All client logic & UI shell live in AdminGate.
    return <AdminGate>{children}</AdminGate>;
}
