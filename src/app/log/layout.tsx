import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "meter.log — Development Log",
  description: "Live development log for Meter. Commits, decisions, and activity in real time.",
};

export default function LogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
