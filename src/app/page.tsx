"use client";

import { useMeterStore } from "@/lib/store";
import { ChatView } from "@/components/chat-view";
import { LoginScreen } from "@/components/login-screen";
import { AuthorizeScreen } from "@/components/authorize-screen";

export default function Home() {
  const authenticated = useMeterStore((s) => s.authenticated);
  const cardOnFile = useMeterStore((s) => s.cardOnFile);

  if (!authenticated) {
    return <LoginScreen />;
  }

  if (!cardOnFile) {
    return <AuthorizeScreen />;
  }

  return <ChatView />;
}
