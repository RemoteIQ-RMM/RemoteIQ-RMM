// components/theme-provider.tsx
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ThemeProviderProps } from "next-themes/dist/types";

/**
 * Wraps next-themes with our defaults:
 * - attribute="class" so Tailwind's `dark` class is toggled on <html>
 * - storageKey to persist user choice
 * - defaultTheme="dark" but also enableSystem so "System" works
 * - disableTransitionOnChange to prevent flash when toggling
 */
export function ThemeProvider({
  children,
  ...props
}: Omit<ThemeProviderProps, "attribute">) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey="riq-theme"
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
