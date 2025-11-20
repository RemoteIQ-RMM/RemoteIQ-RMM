"use client";

import * as React from "react";

/**
 * Branding shape coming from GET /api/branding
 */
export interface Branding {
    primaryColor: string | null;
    secondaryColor: string | null;
    logoLightUrl: string | null;
    logoDarkUrl: string | null;
    loginBackgroundUrl: string | null;
    faviconUrl: string | null;
    emailHeader: string | null;
    emailFooter: string | null;
    customCss: string | null;
    allowClientThemeToggle: boolean | null;
}

type PreviewPatch = Partial<Pick<Branding, "primaryColor" | "secondaryColor" | "faviconUrl">>;

interface BrandingContextType {
    branding: Branding | null;
    isLoaded: boolean;
    applyPreview: (patch: PreviewPatch) => void;
    clearPreview: () => void;
    refetch: () => Promise<void>;
}

const BrandingContext = React.createContext<BrandingContextType | undefined>(undefined);

const DEFAULT_PRIMARY = "#3b82f6";
const DEFAULT_SECONDARY = "#22c55e";
const DEFAULT_FAVICON = "/favicon.ico"; // <- default from public/
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/* ====================== CSS Var helpers ====================== */

function setCssVar(name: string, value: string) {
    document.documentElement.style.setProperty(name, value);
}

// converts hex -> hsl tuple string: "210 100% 56%"
function hexToHslTuple(hex: string): string {
    if (!HEX.test(hex)) {
        return "0 0% 0%";
    }
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let hh = 0;
    let s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                hh = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                hh = (b - r) / d + 2;
                break;
            default:
                hh = (r - g) / d + 4;
        }
        hh /= 6;
    }

    const H = Math.round(hh * 360);
    const S = Math.round(s * 100);
    const L = Math.round(l * 100);
    return `${H} ${S}% ${L}%`;
}

/* ====================== Favicon helpers ====================== */

function ensureFaviconLink(): HTMLLinkElement {
    // Prefer rel="icon", but also handle existing "shortcut icon"
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
    }
    return link;
}

function setFavicon(href: string) {
    const link = ensureFaviconLink();
    link.href = href || DEFAULT_FAVICON;
}

/* ====================== Normalizer ====================== */

function normalizeBranding(b: Branding | null): Branding {
    return {
        primaryColor: b?.primaryColor ?? DEFAULT_PRIMARY,
        secondaryColor: b?.secondaryColor ?? DEFAULT_SECONDARY,
        logoLightUrl: b?.logoLightUrl ?? "",
        logoDarkUrl: b?.logoDarkUrl ?? "",
        loginBackgroundUrl: b?.loginBackgroundUrl ?? "",
        faviconUrl: b?.faviconUrl ?? "",
        emailHeader: b?.emailHeader ?? "<h1>{{org_name}}</h1>",
        emailFooter: b?.emailFooter ?? "<p>Copyright 2025. All rights reserved.</p>",
        customCss: b?.customCss ?? "/* ... */",
        allowClientThemeToggle: b?.allowClientThemeToggle ?? true,
    };
}

/* ====================== Provider ====================== */

export function BrandingProvider({ children }: { children: React.ReactNode }) {
    const [branding, setBranding] = React.useState<Branding | null>(null);
    const [isLoaded, setIsLoaded] = React.useState(false);

    const applyThemeVars = React.useCallback((b: Branding | null) => {
        const primary = b?.primaryColor || DEFAULT_PRIMARY;
        const secondary = b?.secondaryColor || DEFAULT_SECONDARY;
        setCssVar("--primary", hexToHslTuple(primary));
        setCssVar("--secondary", hexToHslTuple(secondary));
    }, []);

    const applyInitialFavicon = React.useCallback((b: Branding | null) => {
        const src = b?.faviconUrl?.trim() || DEFAULT_FAVICON;
        setFavicon(src);
    }, []);

    const fetchBranding = React.useCallback(async () => {
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/branding`, {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) {
                throw new Error(`GET /api/branding failed: ${res.status}`);
            }
            const data = (await res.json()) as Branding;
            const norm = normalizeBranding(data);
            setBranding(norm);
            // apply CSS + favicon
            applyThemeVars(norm);
            applyInitialFavicon(norm);
        } catch (e) {
            // fall back to defaults if fetch fails
            const norm = normalizeBranding(null);
            setBranding(norm);
            applyThemeVars(norm);
            applyInitialFavicon(norm);
            // eslint-disable-next-line no-console
            console.warn(e);
        } finally {
            setIsLoaded(true);
        }
    }, [applyInitialFavicon, applyThemeVars]);

    React.useEffect(() => {
        fetchBranding();
    }, [fetchBranding]);

    /**
     * applyPreview:
     * - Accepts partial { primaryColor?, secondaryColor?, faviconUrl? }
     * - Applies CSS vars and/or favicon temporarily without mutating `branding`.
     */
    const applyPreview = React.useCallback((patch: PreviewPatch) => {
        if (patch.primaryColor) {
            setCssVar("--primary", hexToHslTuple(patch.primaryColor));
        }
        if (patch.secondaryColor) {
            setCssVar("--secondary", hexToHslTuple(patch.secondaryColor));
        }
        if (patch.faviconUrl !== undefined) {
            setFavicon(patch.faviconUrl?.trim() || DEFAULT_FAVICON);
        }
    }, []);

    /**
     * clearPreview:
     * - Reapplies CSS vars + favicon from the current saved branding (or defaults)
     */
    const clearPreview = React.useCallback(() => {
        applyThemeVars(branding);
        applyInitialFavicon(branding);
    }, [applyInitialFavicon, applyThemeVars, branding]);

    const value: BrandingContextType = React.useMemo(
        () => ({ branding, isLoaded, applyPreview, clearPreview, refetch: fetchBranding }),
        [branding, isLoaded, applyPreview, clearPreview, fetchBranding]
    );

    return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
    const ctx = React.useContext(BrandingContext);
    if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
    return ctx;
}
