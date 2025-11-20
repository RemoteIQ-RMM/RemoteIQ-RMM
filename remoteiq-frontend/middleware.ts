import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = new Set<string>([
    "/login",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
]);

function getApiBase(req: NextRequest) {
    const env = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, "");
    if (env) return env;
    // fallback: assume API on same origin at /api
    return req.nextUrl.origin.replace(/\/+$/, "");
}

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Normalize old path
    if (pathname === "/auth/login") {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", "/");
        return NextResponse.redirect(url);
    }

    // Skip static & login
    if (
        pathname === "/login" ||
        pathname.startsWith("/_next/") ||
        pathname.startsWith("/static/") ||
        pathname.startsWith("/images/") ||
        pathname.startsWith("/fonts/")
    ) {
        return NextResponse.next();
    }

    // Allow FE-only API routes
    if (pathname.startsWith("/api/")) {
        return NextResponse.next();
    }

    if (PUBLIC_PATHS.has(pathname)) {
        return NextResponse.next();
    }

    // Require auth cookie in general
    const token = req.cookies.get("auth_token")?.value;
    if (!token) {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname || "/");
        return NextResponse.redirect(url);
    }

    // Hard-gate Administration
    if (pathname.startsWith("/administration")) {
        try {
            const apiBase = getApiBase(req);
            const res = await fetch(`${apiBase}/api/auth/me`, {
                headers: { cookie: req.headers.get("cookie") ?? "" },
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`auth/me ${res.status}`);
            const data = await res.json();
            const perms: string[] =
                data?.user?.permissions ??
                data?.permissions ??
                [];
            const hasAdmin = Array.isArray(perms) && perms.includes("admin.access");
            if (!hasAdmin) {
                const url = req.nextUrl.clone();
                url.pathname = "/";
                url.searchParams.set("denied", "admin");
                return NextResponse.redirect(url);
            }
        } catch {
            const url = req.nextUrl.clone();
            url.pathname = "/login";
            url.searchParams.set("next", pathname || "/");
            return NextResponse.redirect(url);
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|login).*)"],
};
