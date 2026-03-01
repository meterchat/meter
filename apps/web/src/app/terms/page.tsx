import fs from "fs";
import path from "path";
import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Terms of Service — Meter" };

export default function TermsPage() {
  const md = fs.readFileSync(path.join(process.cwd(), "legal/TERMS.md"), "utf-8");
  return <LegalPage markdown={md} />;
}
