// app/account/page.tsx
"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import { useToast } from "@/lib/toast";
import { usePersistedTab } from "@/lib/use-persisted-tab";

import ProfileTab from "./tabs/ProfileTab";
import SecurityTab from "./tabs/SecurityTab";
import SessionsTab from "./tabs/SessionsTab";
import NotificationsTab from "./tabs/NotificationsTab";
import IntegrationsTab from "./tabs/IntegrationsTab";
import ApiTab from "./tabs/ApiTab";
import DeveloperTab from "./tabs/DeveloperTab";
import DangerTab from "./tabs/DangerTab";

import PermGate from "@/components/perm-gate";
import NoPermission from "@/components/no-permission";
import { useMe } from "@/lib/use-me";
import { hasPerm } from "@/lib/permissions";

type TabKey =
    | "profile"
    | "security"
    | "sessions"
    | "notifications"
    | "integrations"
    | "api"
    | "developer"
    | "danger";

const ALLOWED_TABS = [
    "profile",
    "security",
    "sessions",
    "notifications",
    "integrations",
    "api",
    "developer",
    "danger",
] as const;

const HIGH_RISK_TABS = new Set<TabKey>(["security", "integrations", "api", "danger"]);

/**
 * View vs Edit perms:
 * - We show the tab, but gate the content on VIEW perm.
 * - We also disable Save for tabs that require EDIT perm.
 */
const TAB_VIEW_PERM: Record<TabKey, string | string[]> = {
    profile: "me.read",
    security: "me.security",
    sessions: "me.security",
    notifications: "me.read",
    integrations: "me.security",
    api: "me.security",
    developer: "me.read",
    danger: "me.security",
};

const TAB_EDIT_PERM: Record<TabKey, string | string[]> = {
    profile: "me.write",
    security: "me.security",
    sessions: "me.security",
    notifications: "me.write",
    integrations: "me.security",
    api: "me.security",
    developer: "me.write",
    danger: "me.security",
};

export default function AccountPage() {
    const { toast } = useToast();
    const { permissions } = useMe();

    const [activeTab, setActiveTab] = usePersistedTab({
        storageKey: "account.activeTab",
        allowed: ALLOWED_TABS,
        defaultValue: "profile",
        urlParam: "tab",
    });

    const [dirtyByTab, setDirtyByTab] = React.useState<Record<TabKey, boolean>>({
        profile: false,
        security: false,
        sessions: false,
        notifications: false,
        integrations: false,
        api: false,
        developer: false,
        danger: false,
    });

    const saveHandles = React.useRef<Record<TabKey, { submit: () => void } | null>>({
        profile: null,
        security: null,
        sessions: null,
        notifications: null,
        integrations: null,
        api: null,
        developer: null,
        danger: null,
    });

    const [pendingTab, setPendingTab] = React.useState<TabKey | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    const onTabChange = (next: string) => {
        const nextTab = next as TabKey;
        if (nextTab === activeTab) return;

        const isDirty = dirtyByTab[activeTab as TabKey];
        const isHighRisk = HIGH_RISK_TABS.has(activeTab as TabKey);

        if (isDirty && isHighRisk) {
            setPendingTab(nextTab);
            setConfirmOpen(true);
            return;
        }
        setActiveTab(nextTab);
    };

    const confirmLeave = () => {
        setConfirmOpen(false);
        if (pendingTab) {
            const prev = activeTab as TabKey;
            setActiveTab(pendingTab);
            setPendingTab(null);
            toast({
                title: "Unsaved changes discarded",
                variant: "default",
            });
            setDirtyByTab((prevState) => ({ ...prevState, [prev]: false }));
        }
    };

    const cancelLeave = () => {
        setConfirmOpen(false);
        setPendingTab(null);
    };

    const registerSaveHandle =
        (tab: TabKey) =>
            (h: { submit: () => void }) => {
                saveHandles.current[tab] = h;
            };

    const setDirty =
        (tab: TabKey) =>
            (dirty: boolean) => {
                setDirtyByTab((prev) => (prev[tab] === dirty ? prev : { ...prev, [tab]: dirty }));
            };

    const canViewActive = hasPerm(permissions, TAB_VIEW_PERM[activeTab as TabKey]);
    const canEditActive = hasPerm(permissions, TAB_EDIT_PERM[activeTab as TabKey]);

    return (
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-6">
            <Card className="mb-4 p-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    Manage your account settings. Press <kbd>⌘/Ctrl+S</kbd> to save in any tab.
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={() => {
                            const h = saveHandles.current[activeTab as TabKey];
                            if (h) h.submit();
                        }}
                        disabled={!dirtyByTab[activeTab as TabKey] || !canEditActive}
                        aria-label="Save current tab"
                        title={!canEditActive ? "You do not have permission to edit this tab." : undefined}
                    >
                        Save
                    </Button>
                </div>
            </Card>

            <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
                <TabsList className="flex flex-wrap">
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                    <TabsTrigger value="sessions">Sessions</TabsTrigger>
                    <TabsTrigger value="notifications">Notifications</TabsTrigger>
                    <TabsTrigger value="integrations">Integrations</TabsTrigger>
                    <TabsTrigger value="api">API</TabsTrigger>
                    <TabsTrigger value="developer">Developer</TabsTrigger>
                    <TabsTrigger value="danger">Danger</TabsTrigger>
                </TabsList>
                <Separator />

                {/* If the active tab can’t be viewed, show message right where content goes */}
                {!canViewActive ? (
                    <NoPermission
                        title="No permission"
                        message="You don’t have permission to view this section of your account."
                        required={TAB_VIEW_PERM[activeTab as TabKey]}
                    />
                ) : null}

                <TabsContent value="profile" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.profile}
                        title="No permission"
                        message="You don’t have permission to view your profile settings."
                    >
                        <ProfileTab onDirtyChange={setDirty("profile")} saveHandleRef={registerSaveHandle("profile")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="security" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.security}
                        title="No permission"
                        message="You don’t have permission to view security settings."
                    >
                        <SecurityTab onDirtyChange={setDirty("security")} saveHandleRef={registerSaveHandle("security")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="sessions" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.sessions}
                        title="No permission"
                        message="You don’t have permission to view sessions."
                    >
                        <SessionsTab onDirtyChange={setDirty("sessions")} saveHandleRef={registerSaveHandle("sessions")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.notifications}
                        title="No permission"
                        message="You don’t have permission to view notification preferences."
                    >
                        <NotificationsTab onDirtyChange={setDirty("notifications")} saveHandleRef={registerSaveHandle("notifications")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="integrations" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.integrations}
                        title="No permission"
                        message="You don’t have permission to view integrations."
                    >
                        <IntegrationsTab onDirtyChange={setDirty("integrations")} saveHandleRef={registerSaveHandle("integrations")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="api" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.api}
                        title="No permission"
                        message="You don’t have permission to view API settings."
                    >
                        <ApiTab onDirtyChange={setDirty("api")} saveHandleRef={registerSaveHandle("api")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="developer" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.developer}
                        title="No permission"
                        message="You don’t have permission to view developer settings."
                    >
                        <DeveloperTab onDirtyChange={setDirty("developer")} saveHandleRef={registerSaveHandle("developer")} />
                    </PermGate>
                </TabsContent>

                <TabsContent value="danger" className="space-y-4">
                    <PermGate
                        require={TAB_VIEW_PERM.danger}
                        title="No permission"
                        message="You don’t have permission to view dangerous account actions."
                    >
                        <DangerTab onDirtyChange={setDirty("danger")} saveHandleRef={registerSaveHandle("danger")} />
                    </PermGate>
                </TabsContent>
            </Tabs>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes on this tab. If you leave now, they’ll be lost.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={cancelLeave}>Stay</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmLeave}>Discard</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
