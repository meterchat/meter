"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { initPostHog, posthog } from "@/lib/posthog";

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

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <PostHogPageView />
      {children}
    </ThemeProvider>
  );
}
