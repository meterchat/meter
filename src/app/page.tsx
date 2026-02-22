"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMeterStore } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { ChatView } from "@/components/chat-view";
import { LoginScreen } from "@/components/login-screen";

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authenticated = useMeterStore((s) => s.authenticated);
  const cardOnFile = useMeterStore((s) => s.cardOnFile);
  const connectService = useMeterStore((s) => s.connectService);
  const fetchConnectionStatus = useMeterStore((s) => s.fetchConnectionStatus);
  const companies = useWorkspaceStore((s) => s.companies);

  // Handle OAuth callback redirect (still needed for Connections page)
  useEffect(() => {
    const oauthResult = searchParams.get("oauth");
    const provider = searchParams.get("provider");
    if (oauthResult === "success" && provider) {
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

  // Onboarding gate: need auth + at least one workspace + card on file
  const onboardingComplete = authenticated && companies.length > 0 && cardOnFile;

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
