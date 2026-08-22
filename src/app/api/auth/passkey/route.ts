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
import { generateHandle } from "@/lib/handle";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";
import { serverEmitLogEvent } from "@/lib/log-event-server";

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
      const { error: challengeErr } = await supabase.from("auth_challenges").insert({
        id: challengeId,
        challenge: options.challenge,
        type: "login",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      if (challengeErr) throw challengeErr;

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

      // Backfill handle for existing accounts that don't have one
      if (user && !user.handle) {
        const handle = await generateHandle(async (candidate) => {
          const { data } = await supabase
            .from("meter_users")
            .select("id")
            .eq("handle", candidate)
            .maybeSingle();
          return !!data;
        });
        await supabase.from("meter_users").update({ handle }).eq("id", userId);
        user.handle = handle;
      }

      // Create session + cookie
      const sessionToken = await createSession(userId);

      serverEmitLogEvent("user_logged_in", userId);

      const response = NextResponse.json({
        verified: true,
        user: {
          id: user?.id,
          handle: user?.handle ?? null,
          email: user?.email ?? null,
          cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
          cardLast4: user?.card_last4,
          cardBrand: user?.card_brand,
          gmailConnected: user?.gmail_connected ?? false,
          accountType: user?.account_type ?? "standard",
          markupMultiplier: Number(user?.markup_multiplier ?? DEFAULT_MARKUP_MULTIPLIER),
          creditBalance: Number(user?.credit_balance ?? 0),
          hasWorkspaces: (sessionCount ?? 0) > 0,
        },
      });
      setSessionCookie(response, sessionToken);
      return response;
    }

    // ── register-options: create new account + generate passkey registration ──
    if (step === "register-options") {
      return NextResponse.json({ error: "Signups are closed." }, { status: 403 });
      const userId = `usr_${crypto.randomBytes(12).toString("hex")}`;

      // Generate a unique short handle (e.g. "ab41ki")
      const handle = await generateHandle(async (candidate) => {
        const { data } = await supabase
          .from("meter_users")
          .select("id")
          .eq("handle", candidate)
          .maybeSingle();
        return !!data;
      });

      // Create user with handle and auto-generated internal email
      const internalEmail = `${handle}@meter.chat`;

      // DISABLED: Credits feature disabled for launch. Uncomment to reactivate.
      const initialCredit = 0;
      // try {
      //   const { data: config } = await supabase
      //     .from("app_config")
      //     .select("bonus_credit_limit, bonus_credit_amount")
      //     .eq("id", "global")
      //     .single();
      //   if (config) {
      //     const limit = Number(config.bonus_credit_limit) || 0;
      //     const amount = Number(config.bonus_credit_amount) || 0;
      //     if (limit > 0 && amount > 0) {
      //       const { count } = await supabase
      //         .from("meter_users")
      //         .select("id", { count: "exact", head: true });
      //       if ((count ?? 0) < limit) {
      //         initialCredit = amount;
      //       }
      //     }
      //   }
      // } catch { /* non-fatal — skip credit grant */ }

      const { error: insertErr } = await supabase
        .from("meter_users")
        .insert({
          id: userId,
          handle,
          email: internalEmail,
          ...(initialCredit > 0 ? { credit_balance: initialCredit } : {}),
        });
      if (insertErr) throw insertErr;

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: handle,
        userDisplayName: handle,
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "preferred",
        },
      });

      const challengeId = crypto.randomBytes(16).toString("hex");
      const { error: registerChallengeErr } = await supabase.from("auth_challenges").insert({
        id: challengeId,
        user_id: userId,
        challenge: options.challenge,
        type: "register",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      if (registerChallengeErr) throw registerChallengeErr;

      return NextResponse.json({ options, challengeId, userId });
    }

    // ── register-verify: verify new passkey registration ──
    if (step === "register-verify") {
      return NextResponse.json({ error: "Signups are closed." }, { status: 403 });
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
