import { NextResponse } from "next/server";
import {
  getSessionToken,
  deleteSession,
  clearSessionCookie,
} from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  const token = await getSessionToken();
  if (token) {
    await deleteSession(token);
  }
  clearSessionCookie(response);

  return response;
}
