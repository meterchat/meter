import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

const SESSION_COOKIE = "meter_session";
const SESSION_TTL_DAYS = 30;

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const supabase = getSupabaseServer();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const { error } = await supabase.from("auth_sessions").insert({
    token,
    user_id: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return token;
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("auth_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();

  if (error) {
    // PGRST116 = row not found — genuine "no session"
    if (error.code === "PGRST116") return null;
    // Any other error is a transient DB issue — retry once before giving up
    const retry = await supabase
      .from("auth_sessions")
      .select("user_id, expires_at")
      .eq("token", token)
      .single();
    if (retry.error || !retry.data) return null;
    // Use retry result
    if (new Date(retry.data.expires_at) < new Date()) {
      await supabase.from("auth_sessions").delete().eq("token", token);
      return null;
    }
    return retry.data.user_id;
  }

  if (!data) return null;

  if (new Date(data.expires_at) < new Date()) {
    // Expired — clean up
    await supabase.from("auth_sessions").delete().eq("token", token);
    return null;
  }

  return data.user_id;
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function deleteSession(token: string) {
  const supabase = getSupabaseServer();
  await supabase.from("auth_sessions").delete().eq("token", token);
}

export async function deleteAllUserSessions(userId: string) {
  const supabase = getSupabaseServer();
  await supabase.from("auth_sessions").delete().eq("user_id", userId);
}
