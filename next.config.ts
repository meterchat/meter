import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isMobileBuild = process.env.CAPACITOR_BUILD === "1";

const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://whop.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  connect-src 'self' https://openrouter.ai https://whop.com https://api.whop.com https://*.supabase.co https://accounts.google.com https://oauth2.googleapis.com https://github.com https://api.github.com https://vercel.com https://api.vercel.com https://connect.stripe.com https://api.mercury.com https://api.ramp.com https://*.ingest.sentry.io;
  frame-src https://whop.com https://accounts.google.com;
  worker-src 'self' blob:;
  manifest-src 'self';
`.replace(/\n/g, ' ').trim();

const nextConfig: NextConfig = {
  // Static export for Capacitor mobile builds; normal SSR for web
  ...(isMobileBuild && {
    output: "export",
    images: { unoptimized: true },
  }),
  // CSP headers only work in server mode (not static export)
  ...(!isMobileBuild && {
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            {
              key: "Content-Security-Policy",
              value: csp,
            },
          ],
        },
      ];
    },
    async rewrites() {
      return [
        {
          source: "/.well-known/apple-developer-merchantid-domain-association",
          destination: "/api/well-known/apple-pay",
        },
      ];
    },
  }),
  ...(!isMobileBuild && {
    images: {
      remotePatterns: [
        { protocol: 'https', hostname: '**' },
        { protocol: 'http', hostname: '**' },
      ],
    },
  }),
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
} as NextConfig;

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
