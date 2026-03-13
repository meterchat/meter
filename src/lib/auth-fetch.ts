import { apiUrl } from "@/lib/api-url";

/**
 * Fetch wrapper that always includes credentials (cookies).
 * Use this for all authenticated API calls from client code.
 */
export function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: "include", ...init });
}
