"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { initPostHog, posthog } from "@/lib/posthog";
import { isNative } from "@/lib/platform";

function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    if (pathname) {
      posthog.capture("$pageview", { $current_url: window.location.href });
    }
  }, [pathname]);

  return null;
}

function CapacitorInit() {
  useEffect(() => {
    if (!isNative) return;
    (async () => {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      const { Keyboard } = await import("@capacitor/keyboard");
      const { SplashScreen } = await import("@capacitor/splash-screen");
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#111a14" }).catch(() => {});
      Keyboard.setResizeMode({ mode: "body" as never }).catch(() => {});
      SplashScreen.hide().catch(() => {});
    })();
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false}>
      <PostHogPageView />
      <CapacitorInit />
      {children}
    </ThemeProvider>
  );
}
