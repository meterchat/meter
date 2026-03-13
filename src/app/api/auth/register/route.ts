import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import crypto from "crypto";
import { createSession, setSessionCookie } from "@/lib/session";
import { serverTrackAccountCreated } from "@/lib/analytics-server";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";

const RP_NAME = "Meter";
const RP_ID = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || "meter.chat";
const BASE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://meter.chat";
// Accept both www and non-www origins for WebAuthn verification
const EXPECTED_ORIGINS = [
  BASE_ORIGIN,
  BASE_ORIGIN.replace("://", "://www."),
  BASE_ORIGIN.replace("://www.", "://"),
].filter((v, i, a) => a.indexOf(v) === i);

// POST /api/auth/register — start or verify passkey registration
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { step, email } = body;

    const supabase = getSupabaseServer();

    if (step === "options") {
      // Step 1: Generate registration options
      const normalizedEmail = email.toLowerCase().trim();

      // Create user if doesn't exist
      let userId: string;
      const { data: existingUser } = await supabase
        .from("meter_users")
        .select("id")
        .eq("email", normalizedEmail)
        .single();

      if (existingUser) {
        userId = existingUser.id;
      } else {
        userId = `usr_${crypto.randomBytes(12).toString("hex")}`;
        const { error: insertErr } = await supabase
          .from("meter_users")
          .insert({ id: userId, email: normalizedEmail });
        if (insertErr) throw insertErr;
      }

      // Get existing credentials for this user (to exclude)
      const { data: existingCreds } = await supabase
        .from("passkey_credentials")
        .select("credential_id")
        .eq("user_id", userId);

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: normalizedEmail,
        userDisplayName: normalizedEmail.split("@")[0],
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "preferred",
        },
        excludeCredentials: (existingCreds ?? []).map((c) => ({
          id: c.credential_id,
        })),
      });

      // Store challenge
      const challengeId = crypto.randomBytes(16).toString("hex");
      await supabase.from("auth_challenges").insert({
        id: challengeId,
        email: normalizedEmail,
        challenge: options.challenge,
        type: "register",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      return NextResponse.json({
        options,
        challengeId,
        userId,
      });
    }

    if (step === "verify") {
      // Step 2: Verify registration response
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

      // Store the credential
      // regCred.id is already Base64URLString in @simplewebauthn/server v11
      // regCred.publicKey is Uint8Array and needs encoding
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

      // Create server-side session and set cookie
      const sessionToken = await createSession(uid);

      serverTrackAccountCreated(uid, { email: user?.email ?? "" });

      const response = NextResponse.json({
        verified: true,
        user: {
          id: user?.id,
          email: user?.email,
          cardOnFile: !!user?.stripe_customer_id && !!user?.card_last4,
          cardLast4: user?.card_last4,
          gmailConnected: user?.gmail_connected ?? false,
          accountType: user?.account_type ?? "standard",
          markupMultiplier: Number(user?.markup_multiplier ?? DEFAULT_MARKUP_MULTIPLIER),
        },
      });
      setSessionCookie(response, sessionToken);
      return response;
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Register error:", message);
    return NextResponse.json(
      { error: message.includes("relation") ? "Database tables not set up. Visit /api/setup-db first." : message },
      { status: 500 }
    );
  }
}
