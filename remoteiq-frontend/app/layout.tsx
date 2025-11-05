// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import Providers from "@/app/providers";
import { BrandingProvider } from "./providers/BrandingProvider";
import { ToastProvider } from "@/lib/toast";
import Toaster from "@/components/ui/toaster";

export const runtime = "nodejs";
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RemoteIQ",
  description: "Next-generation Remote Monitoring & Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // important: keep suppressHydrationWarning on <html> for next-themes
    <html lang="en" suppressHydrationWarning>
      {/* DO NOT put a fixed bg here; use semantic tokens so light/dark both work */}
      <body className={cn("min-h-screen bg-background text-foreground font-sans antialiased", inter.className)}>
        <ToastProvider>
          {/* ThemeProvider is what reads/writes the riq-theme key and toggles the `dark` class on <html> */}
          <ThemeProvider>
            <BrandingProvider>
              <Providers>{children}</Providers>
            </BrandingProvider>
          </ThemeProvider>
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
