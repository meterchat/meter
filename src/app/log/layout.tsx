import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meter Log — Development Feed",
  description: "Live development feed for Meter. Commits, decisions, and activity in real time.",
};

export default function LogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
