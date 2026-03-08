import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import crypto from "crypto";
import { createSession, setSessionCookie } from "@/lib/session";
import { serverTrackUserLoggedIn, serverTrackLoginFailed } from "@/lib/analytics-server";

const RP_ID = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || "meter.chat";
const BASE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://meter.chat";
const EXPECTED_ORIGINS = [
  BASE_ORIGIN,
  BASE_ORIGIN.replace("://", "://www."),
  BASE_ORIGIN.replace("://www.", "://"),
  ...(process.env.WEBAUTHN_PREVIEW_ORIGINS?.split(",") || []),
].filter((v, i, a) => v && a.indexOf(v) === i);

// POST /api/auth/login — start or verify passkey login
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { step, email } = body;

    const supabase = getSupabaseServer();

    if (step === "options") {
      const normalizedEmail = email.toLowerCase().trim();

      // Find user
      const { data: user } = await supabase
        .from("meter_users")
        .select("id")
        .eq("email", normalizedEmail)
        .single();

      if (!user) {
        serverTrackLoginFailed({ email: normalizedEmail, reason: "user_not_found" });
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Get their credentials
      const { data: creds } = await supabase
        .from("passkey_credentials")
        .select("*")
        .eq("user_id", user.id);

      if (!creds || creds.length === 0) {
        return NextResponse.json({ error: "No passkeys registered" }, { status: 400 });
      }

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: creds.map((c) => ({
          id: c.credential_id,
          transports: (c.transports?.length
            ? c.transports
            : ["internal", "hybrid"]) as ("ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb")[],
        })),
        userVerification: "preferred",
      });

      // Store challenge
      const challengeId = crypto.randomBytes(16).toString("hex");
      await supabase.from("auth_challenges").insert({
        id: challengeId,
        email: normalizedEmail,
        challenge: options.challenge,
        type: "login",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return NextResponse.json({ options, challengeId, userId: user.id });
    }

    if (step === "verify") {
      const { challengeId, credential, userId: uid } = body;

      const { data: challengeRecord } = await supabase
        .from("auth_challenges")
        .select("*")
        .eq("id", challengeId)
        .single();

      if (!challengeRecord) {
        return NextResponse.json({ error: "Challenge not found" }, { status: 400 });
      }

      if (new Date(challengeRecord.expires_at) < new Date()) {
        return NextResponse.json({ error: "Challenge expired" }, { status: 400 });
      }

      // Find the credential
      const credentialId = credential.id;
      const { data: storedCred } = await supabase
        .from("passkey_credentials")
        .select("*")
        .eq("credential_id", credentialId)
        .eq("user_id", uid)
        .single();

      if (!storedCred) {
        return NextResponse.json({ error: "Credential not found" }, { status: 400 });
      }

      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: storedCred.credential_id,
          publicKey: Buffer.from(storedCred.public_key, "base64url"),
          counter: storedCred.counter,
          transports: (storedCred.transports ?? []) as ("ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb")[],
        },
      });

      if (!verification.verified) {
        serverTrackLoginFailed({ email: challengeRecord.email ?? "", reason: "verification_failed" });
        return NextResponse.json({ error: "Verification failed" }, { status: 400 });
      }

      // Update counter
      await supabase
        .from("passkey_credentials")
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq("credential_id", credentialId);

      // Clean up challenge
      await supabase.from("auth_challenges").delete().eq("id", challengeId);

      // Get user details + check if they have existing workspaces (sessions)
      const [{ data: user }, { count: sessionCount }] = await Promise.all([
        supabase.from("meter_users").select("*").eq("id", uid).single(),
        supabase
          .from("chat_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .is("deleted_at", null)
          .limit(1),
      ]);

      // Create server-side session and set cookie
      const sessionToken = await createSession(uid);
      serverTrackUserLoggedIn(uid, {
        email: user?.email,
        hasWorkspaces: (sessionCount ?? 0) > 0,
        cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
      });
      const response = NextResponse.json({
        verified: true,
        user: {
          id: user?.id,
          email: user?.email,
          cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
          cardLast4: user?.card_last4,
          cardBrand: user?.card_brand,
          gmailConnected: user?.gmail_connected ?? false,
          accountType: user?.account_type ?? "standard",
          markupMultiplier: Number(user?.markup_multiplier ?? 1),
          hasWorkspaces: (sessionCount ?? 0) > 0,
        },
      });
      setSessionCookie(response, sessionToken);
      return response;
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Login error:", message);
    return NextResponse.json(
      { error: message.includes("relation") ? "Database tables not set up. Visit /api/setup-db first." : message },
      { status: 500 }
    );
  }
}
