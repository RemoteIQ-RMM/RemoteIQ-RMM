"use client";

import * as React from "react";
import Image from "next/image";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ToastFn } from "../types";
import { getCompanyProfile, saveCompanyProfile, type CompanyProfile } from "@/lib/api";

/* ---------------------------------- helpers --------------------------------- */
function getApiBase(): string {
    const raw = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!raw) return "/api";
    return raw.endsWith("/api") ? raw : `${raw}/api`;
}
const API_BASE = getApiBase();

type BrandPayload = {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    logoUrl?: string | null;
    emailHeader?: string | null;
    emailFooter?: string | null;
};

function safeStr(v: unknown) {
    return typeof v === "string" ? v : "";
}

const preset = (k: string) => `{{${k}}}`;

/* =============================== Component ================================== */
export default function CompanyTab({ push }: { push: ToastFn }) {
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    // Company form
    const [form, setForm] = React.useState<CompanyProfile>({
        name: "",
        legalName: "",
        email: "",
        phone: "",
        fax: "",
        website: "",
        vatTin: "",
        address1: "",
        address2: "",
        city: "",
        state: "",
        postal: "",
        country: "",
    });

    // Branding (best-effort fetch)
    const [brand, setBrand] = React.useState<BrandPayload>({
        primaryColor: undefined,
        secondaryColor: undefined,
        logoUrl: undefined,
    });

    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [company, branding] = await Promise.allSettled([
                    getCompanyProfile(),
                    fetch(`${API_BASE}/branding`, {
                        credentials: "include",
                        cache: "no-store",
                    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET /branding ${r.status}`)))),
                ]);

                if (alive) {
                    if (company.status === "fulfilled") {
                        setForm((prev) => ({ ...prev, ...company.value }));
                    } else {
                        push({
                            title: "Failed to load company profile",
                            desc: (company as any)?.reason?.message ?? "Request failed",
                            kind: "destructive",
                        });
                    }

                    if (branding.status === "fulfilled") {
                        const b = branding.value as any;
                        setBrand({
                            primaryColor: safeStr(b?.primaryColor) || undefined,
                            secondaryColor: safeStr(b?.secondaryColor) || undefined,
                            logoUrl: safeStr(b?.logoUrl) || undefined,
                            emailHeader: safeStr(b?.emailHeader) || undefined,
                            emailFooter: safeStr(b?.emailFooter) || undefined,
                        });
                    }
                }
            } catch {
                // Branding is optional; only warn on company error above
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [push]);

    const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    async function onSave() {
        setSaving(true);
        try {
            const { id, ...payload } = form as any;
            await saveCompanyProfile(payload);
            push({ title: "Company profile saved", kind: "success" });
        } catch (e: any) {
            push({ title: "Save failed", desc: e?.message, kind: "destructive" });
        } finally {
            setSaving(false);
        }
    }

    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            push({ title: "Copied", desc: text, kind: "success" });
        } catch {
            push({ title: "Copy failed", desc: "Clipboard permission denied.", kind: "destructive" });
        }
    }

    if (loading) return null;

    const brandPrimary = brand.primaryColor || undefined;

    return (
        <section id="company" className="space-y-4">
            <Card>
                <CardHeader className="gap-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Company profile</CardTitle>
                            <CardDescription>
                                Basic organization identity & contact details used across billing, emails, and the client portal.
                            </CardDescription>

                            <div className="mt-2 text-xs text-muted-foreground">
                                Preset variables from this tab use <span className="font-mono">{preset("company.*")}</span> (example:{" "}
                                <span className="font-mono">{preset("company.name")}</span>).
                            </div>
                        </div>

                        {brand.logoUrl ? (
                            <div
                                className="flex items-center justify-center rounded-md border bg-card p-2"
                                style={brandPrimary ? { borderColor: brandPrimary } : undefined}
                                title={`Preset variable: ${preset("branding.logoUrl")}`}
                            >
                                <Image
                                    src={brand.logoUrl}
                                    alt="Organization Logo"
                                    width={120}
                                    height={40}
                                    unoptimized
                                    priority
                                    style={{ objectFit: "contain" }}
                                />
                            </div>
                        ) : null}
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Identity */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="Company Name *"
                            value={form.name}
                            onChange={(v) => set("name", v)}
                            required
                            presetVar={preset("company.name")}
                            onCopy={copy}
                        />
                        <Field
                            label="Legal Name"
                            value={form.legalName ?? ""}
                            onChange={(v) => set("legalName", v)}
                            presetVar={preset("company.legalName")}
                            onCopy={copy}
                        />
                        <Field
                            label="Email"
                            type="email"
                            value={form.email ?? ""}
                            onChange={(v) => set("email", v)}
                            presetVar={preset("company.email")}
                            onCopy={copy}
                        />
                        <Field
                            label="Phone"
                            value={form.phone ?? ""}
                            onChange={(v) => set("phone", v)}
                            presetVar={preset("company.phone")}
                            onCopy={copy}
                        />
                        <Field
                            label="Fax"
                            value={form.fax ?? ""}
                            onChange={(v) => set("fax", v)}
                            presetVar={preset("company.fax")}
                            onCopy={copy}
                        />
                        <Field
                            label="Website (https://...)"
                            value={form.website ?? ""}
                            onChange={(v) => set("website", v)}
                            placeholder="https://example.com"
                            presetVar={preset("company.website")}
                            onCopy={copy}
                        />
                        <Field
                            label="VAT / TIN"
                            value={form.vatTin ?? ""}
                            onChange={(v) => set("vatTin", v)}
                            presetVar={preset("company.vatTin")}
                            onCopy={copy}
                        />
                        <div className="hidden md:block" />
                    </div>

                    {/* Address */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="Address Line 1"
                            value={form.address1 ?? ""}
                            onChange={(v) => set("address1", v)}
                            presetVar={preset("company.address1")}
                            onCopy={copy}
                        />
                        <Field
                            label="Address Line 2"
                            value={form.address2 ?? ""}
                            onChange={(v) => set("address2", v)}
                            presetVar={preset("company.address2")}
                            onCopy={copy}
                        />
                        <Field
                            label="City"
                            value={form.city ?? ""}
                            onChange={(v) => set("city", v)}
                            presetVar={preset("company.city")}
                            onCopy={copy}
                        />
                        <Field
                            label="State / Province"
                            value={form.state ?? ""}
                            onChange={(v) => set("state", v)}
                            presetVar={preset("company.state")}
                            onCopy={copy}
                        />
                        <Field
                            label="Postal Code"
                            value={form.postal ?? ""}
                            onChange={(v) => set("postal", v)}
                            presetVar={preset("company.postal")}
                            onCopy={copy}
                        />
                        <Field
                            label="Country"
                            value={form.country ?? ""}
                            onChange={(v) => set("country", v)}
                            presetVar={preset("company.country")}
                            onCopy={copy}
                        />
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-xs text-muted-foreground space-y-1">
                            <div>
                                Branding preset variables (best-effort):{" "}
                                <span className="font-mono">{preset("branding.primaryColor")}</span>,{" "}
                                <span className="font-mono">{preset("branding.secondaryColor")}</span>,{" "}
                                <span className="font-mono">{preset("branding.logoUrl")}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => copy(preset("branding.logoUrl"))}
                                >
                                    Copy logo var
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => copy(preset("branding.primaryColor"))}
                                >
                                    Copy primary color var
                                </Button>
                            </div>
                        </div>

                        <Button
                            onClick={onSave}
                            disabled={saving || !form.name}
                            style={
                                brandPrimary
                                    ? ({
                                        ["--brand-primary" as any]: brandPrimary,
                                    } as React.CSSProperties)
                                    : undefined
                            }
                            className={brandPrimary ? "border-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10" : ""}
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </section>
    );
}

/* --------------------------------- Field ----------------------------------- */

function Field({
    label,
    value,
    onChange,
    type = "text",
    placeholder,
    required,
    presetVar,
    onCopy,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: React.ComponentProps<typeof Input>["type"];
    placeholder?: string;
    required?: boolean;
    presetVar: string;
    onCopy: (t: string) => void;
}) {
    return (
        <div className="grid gap-1">
            <Label className="text-sm">
                {label} {required ? <span className="text-red-500">*</span> : null}
            </Label>
            <Input
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />

            <div className="mt-1 flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                    Preset variable: <span className="font-mono">{presetVar}</span>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => onCopy(presetVar)}
                    title="Copy preset variable"
                >
                    Copy
                </Button>
            </div>
        </div>
    );
}
