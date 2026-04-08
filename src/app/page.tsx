"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMeterStore } from "@/lib/store";
import { trackConnectorConnected } from "@/lib/analytics";
import { useSessionSync } from "@/lib/use-session-sync";
import { ChatView } from "@/components/chat-view";
import { LandingPage } from "@/components/landing-page";

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authenticated = useMeterStore((s) => s.authenticated);
  const sessionsLoaded = useMeterStore((s) => s.sessionsLoaded);
  const connectService = useMeterStore((s) => s.connectService);
  const fetchConnectionStatus = useMeterStore((s) => s.fetchConnectionStatus);

  // Run session sync at page level — must run even before ChatView mounts
  // so that sessionsLoaded becomes true and ChatView can render safely.
  useSessionSync();

  // Handle OAuth callback redirect (still needed for Connections page)
  useEffect(() => {
    const oauthResult = searchParams.get("oauth");
    const provider = searchParams.get("provider");
    if (oauthResult === "success" && provider) {
      trackConnectorConnected({ provider });
      connectService(provider);
      fetchConnectionStatus();
      router.replace("/");
    }
  }, [searchParams, connectService, fetchConnectionStatus, router]);

  // Sync connection status from server on mount
  useEffect(() => {
    if (authenticated) {
      fetchConnectionStatus();
    }
  }, [authenticated, fetchConnectionStatus]);

  if (!authenticated) {
    return <LandingPage />;
  }

  // Don't mount ChatView until sessions are loaded from server.
  // This prevents all hooks/effects from firing into empty/broken state.
  if (!sessionsLoaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
          <p className="font-mono text-[11px] text-muted-foreground/60">Loading</p>
        </div>
      </div>
    );
  }

  return <ChatView />;
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
