import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meter — Use First, Pay After",
  description: "Every AI model. One bill. No subscription. The meter runs in dollars.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href="/logo-dark-copy.webp" />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <link key={n} rel="preload" as="image" href={`/frame-${n}.png`} />
        ))}
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
