// src/lib/supabase-realtime.ts
"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { authFetch } from "@/lib/auth-fetch";

// Cache the initialization PROMISE, not the client. This prevents a race
// where two callers both see `client === null`, both start initializing,
// and one returns the client before setAuth() completes.
let initPromise: Promise<SupabaseClient> | null = null;
let client: SupabaseClient | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const TOKEN_REFRESH_MS = 50 * 60 * 1000; // 50 minutes (token expires in 60)

async function fetchRealtimeToken(): Promise<string> {
  const res = await authFetch("/api/realtime/token");
  if (!res.ok) throw new Error(`Failed to fetch Realtime token: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function initialize(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase env vars");

  const newClient = createClient(url, anonKey, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  // Authenticate BEFORE exposing the client
  const token = await fetchRealtimeToken();
  newClient.realtime.setAuth(token);

  // Refresh token before expiry
  refreshTimer = setInterval(async () => {
    try {
      const newToken = await fetchRealtimeToken();
      newClient.realtime.setAuth(newToken);
    } catch {
      // Token refresh failed — Realtime will disconnect on expiry.
      // The Supabase client's built-in reconnect will retry.
    }
  }, TOKEN_REFRESH_MS);

  client = newClient;
  return newClient;
}

/**
 * Get (or create) the browser-side Supabase client for Realtime subscriptions.
 * On first call, fetches a JWT from /api/realtime/token and starts a
 * 50-minute refresh timer. Concurrent callers share the same initialization
 * promise, so the client is never returned before authentication completes.
 */
export function getRealtimeClient(): Promise<SupabaseClient> {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

/**
 * Tear down the Realtime client. Removes all channels, stops the token
 * refresh timer, and resets the singleton. Call on logout.
 */
export function destroyRealtimeClient() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    client.removeAllChannels();
    client = null;
  }
  initPromise = null;
}
