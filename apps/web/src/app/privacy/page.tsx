import fs from "fs";
import path from "path";
import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Privacy Policy — Meter" };

export default function PrivacyPage() {
  const md = fs.readFileSync(path.join(process.cwd(), "../../legal/PRIVACY.md"), "utf-8");
  return <LegalPage markdown={md} />;
}
