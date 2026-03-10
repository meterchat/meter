import type { Metadata } from "next";
import { getSessionUserId } from "@/lib/session";
import { isSuperAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Meter Log — Development Feed",
  description: "Live development feed for Meter. Commits, decisions, and activity in real time.",
};

export default async function LogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getSessionUserId();

  if (!userId || !(await isSuperAdmin(userId))) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center font-mono">
          <p className="text-sm text-foreground">not authorized</p>
          <p className="text-[11px] text-muted-foreground/50 mt-1">
            sign in at meter.chat with a superadmin account
          </p>
        </div>
      </div>
    );
  }

  return children;
}
