/**
 * Returns the base URL for API calls.
 * - Web (Vercel): empty string → relative /api/... paths work natively
 * - Mobile (Capacitor static build): NEXT_PUBLIC_API_URL points at the Vercel deployment
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
