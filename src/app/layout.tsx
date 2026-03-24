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
  title: "Meter ✜ Pay Per Thought",
  description: "Every AI model. One bill. No subscription. The meter runs in dollars.",
  metadataBase: new URL("https://meter.chat"),
  openGraph: {
    title: "Meter ✜ Pay Per Thought",
    description: "Every AI model. One bill. No subscription. The meter runs in dollars.",
    url: "https://meter.chat",
    siteName: "Meter",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Meter — Pay Per Thought",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Meter ✜ Pay Per Thought",
    description: "Every AI model. One bill. No subscription. The meter runs in dollars.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://meter.chat",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Meter",
  url: "https://meter.chat",
  description:
    "Pay-per-thought AI platform for builders. Routes across frontier models, runs structured multi-model debates, logs decisions as durable records, and commits Agent Spec Kits to GitHub.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Pay-per-use pricing based on token usage. No subscription required.",
  },
  creator: {
    "@type": "Organization",
    name: "Meter",
    url: "https://meter.chat",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preload" as="image" href="/logo-dark-copy.webp" />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <link key={n} rel="preload" as="image" href={`/frame-${n}.png`} />
        ))}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <Providers>
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
