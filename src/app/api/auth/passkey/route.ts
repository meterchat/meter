import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import crypto from "crypto";
import { createSession, setSessionCookie } from "@/lib/session";

const RP_NAME = "Meter";
const RP_ID = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || "meter.chat";
const BASE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://meter.chat";
const EXPECTED_ORIGINS = [
  BASE_ORIGIN,
  BASE_ORIGIN.replace("://", "://www."),
  BASE_ORIGIN.replace("://www.", "://"),
].filter((v, i, a) => a.indexOf(v) === i);

// POST /api/auth/passkey — unified passkey-only auth (no email required)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { step } = body;
    const supabase = getSupabaseServer();

    // ── auth-options: generate challenge for discoverable credential login ──
    if (step === "auth-options") {
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        // No allowCredentials — browser discovers credentials for this RP
        userVerification: "preferred",
      });

      const challengeId = crypto.randomBytes(16).toString("hex");
      await supabase.from("auth_challenges").insert({
        id: challengeId,
        challenge: options.challenge,
        type: "login",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return NextResponse.json({ options, challengeId });
    }

    // ── auth-verify: verify login credential, resolve user from credential_id ──
    if (step === "auth-verify") {
      const { challengeId, credential } = body;

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

      // Find stored credential by credential ID (NOT by email)
      const credentialId = credential.id;
      const { data: storedCred } = await supabase
        .from("passkey_credentials")
        .select("*")
        .eq("credential_id", credentialId)
        .single();

      if (!storedCred) {
        return NextResponse.json({ error: "Credential not found" }, { status: 400 });
      }

      const userId = storedCred.user_id;

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
        return NextResponse.json({ error: "Verification failed" }, { status: 400 });
      }

      // Update counter
      await supabase
        .from("passkey_credentials")
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq("credential_id", credentialId);

      // Clean up challenge
      await supabase.from("auth_challenges").delete().eq("id", challengeId);

      // Get user details + check workspaces
      const [{ data: user }, { count: sessionCount }] = await Promise.all([
        supabase.from("meter_users").select("*").eq("id", userId).single(),
        supabase
          .from("chat_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("deleted_at", null)
          .limit(1),
      ]);

      // Create session + cookie
      const sessionToken = await createSession(userId);
      const response = NextResponse.json({
        verified: true,
        user: {
          id: user?.id,
          email: user?.email ?? null,
          cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
          cardLast4: user?.card_last4,
          cardBrand: user?.card_brand,
          gmailConnected: user?.gmail_connected ?? false,
          accountType: user?.account_type ?? "standard",
          markupMultiplier: Number(user?.markup_multiplier ?? 2),
          hasWorkspaces: (sessionCount ?? 0) > 0,
        },
      });
      setSessionCookie(response, sessionToken);
      return response;
    }

    // ── register-options: create new account + generate passkey registration ──
    if (step === "register-options") {
      const userId = `usr_${crypto.randomBytes(12).toString("hex")}`;

      // Create user with no email
      const { error: insertErr } = await supabase
        .from("meter_users")
        .insert({ id: userId });
      if (insertErr) throw insertErr;

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: userId,
        userDisplayName: "Meter User",
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "preferred",
        },
      });

      const challengeId = crypto.randomBytes(16).toString("hex");
      await supabase.from("auth_challenges").insert({
        id: challengeId,
        user_id: userId,
        challenge: options.challenge,
        type: "register",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return NextResponse.json({ options, challengeId, userId });
    }

    // ── register-verify: verify new passkey registration ──
    if (step === "register-verify") {
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

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return NextResponse.json({ error: "Verification failed" }, { status: 400 });
      }

      const { credential: regCred, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;

      // Store credential
      await supabase.from("passkey_credentials").insert({
        credential_id: regCred.id,
        user_id: uid,
        public_key: Buffer.from(regCred.publicKey).toString("base64url"),
        counter: regCred.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: (credential.response?.transports?.length
          ? credential.response.transports
          : ["internal", "hybrid"]),
      });

      // Clean up challenge
      await supabase.from("auth_challenges").delete().eq("id", challengeId);

      // Get user
      const { data: user } = await supabase
        .from("meter_users")
        .select("*")
        .eq("id", uid)
        .single();

      // Create session + cookie
      const sessionToken = await createSession(uid);
      const response = NextResponse.json({
        verified: true,
        user: {
          id: user?.id,
          email: user?.email ?? null,
          cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
          cardLast4: user?.card_last4,
          cardBrand: user?.card_brand,
          gmailConnected: user?.gmail_connected ?? false,
          accountType: user?.account_type ?? "standard",
          markupMultiplier: Number(user?.markup_multiplier ?? 2),
        },
      });
      setSessionCookie(response, sessionToken);
      return response;
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Passkey auth error:", message);
    return NextResponse.json(
      { error: message.includes("relation") ? "Database tables not set up. Visit /api/setup-db first." : message },
      { status: 500 }
    );
  }
}
