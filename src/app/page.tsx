"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMeterStore } from "@/lib/store";
import { trackConnectorConnected } from "@/lib/analytics";
import { ChatView } from "@/components/chat-view";
import { LoginScreen } from "@/components/login-screen";

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authenticated = useMeterStore((s) => s.authenticated);
  const cardOnFile = useMeterStore((s) => s.cardOnFile);
  const connectService = useMeterStore((s) => s.connectService);
  const fetchConnectionStatus = useMeterStore((s) => s.fetchConnectionStatus);
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

  // Onboarding gate: need auth + at least one workspace + card on file.
  // For returning users (auth + card), skip straight to ChatView even if
  // companies haven't loaded yet — useSessionSync inside ChatView will
  // populate them from the server.  Requiring companies.length > 0 here
  // caused a race condition where the "create workspace" screen flashed
  // on every login.
  const onboardingComplete = authenticated && cardOnFile;

  if (!onboardingComplete) {
    return <LoginScreen />;
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
