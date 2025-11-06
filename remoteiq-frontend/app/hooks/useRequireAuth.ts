// app/hooks/useRequireAuth.ts
"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001").replace(/\/+$/, "");

type MeResponse =
    | { user: null }
    | {
          user: {
              id: string;
              email: string;
              name: string;
              role: string;
              roleId?: string | null;
              roles?: Array<{ id: string; name: string }>;
          };
      };

export function useRequireAuth() {
    const [loading, setLoading] = React.useState(true);
    const [user, setUser] = React.useState<MeResponse["user"]>(null);
    const router = useRouter();
    const pathname = usePathname();

    React.useEffect(() => {
        let cancelled = false;

        async function run() {
            try {
                const res = await fetch(`${API_BASE}/api/auth/me`, {
                    method: "GET",
                    credentials: "include",
                });
                if (!res.ok) throw new Error(String(res.status));
                const data: MeResponse = await res.json();
                if (!cancelled) {
                    setUser(data.user ?? null);
                    if (!data.user) {
                        const next = encodeURIComponent(pathname || "/");
                        router.replace(`/login?next=${next}`);
                    }
                }
            } catch {
                if (!cancelled) {
                    const next = encodeURIComponent(pathname || "/");
                    router.replace(`/login?next=${next}`);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        run();
        return () => { cancelled = true; };
    }, [pathname, router]);

    return { loading, user };
}
