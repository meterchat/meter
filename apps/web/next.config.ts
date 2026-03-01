import type { NextConfig } from "next";

const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  connect-src 'self' https://openrouter.ai https://js.stripe.com https://api.stripe.com https://*.supabase.co https://accounts.google.com https://oauth2.googleapis.com https://github.com https://api.github.com https://vercel.com https://api.vercel.com https://connect.stripe.com https://api.mercury.com https://api.ramp.com;
  frame-src https://js.stripe.com https://accounts.google.com;
  worker-src 'self' blob:;
  manifest-src 'self';
`.replace(/\n/g, ' ').trim();

const nextConfig: NextConfig = {
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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
} as NextConfig;

export default nextConfig;
