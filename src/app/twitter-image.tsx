import { ImageResponse } from "next/og";
import { OgImageContent } from "@/lib/og-image";

export const runtime = "edge";
export const alt = "Meter — Pay Per Thought";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(<OgImageContent />, { ...size });
}
