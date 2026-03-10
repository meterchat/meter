import crypto from "crypto";

/**
 * Generate a short alphanumeric user handle (6 chars, lowercase).
 *
 * Examples: "ab41ki", "x7m2fp", "k9n3ql"
 *
 * 36^6 ≈ 2.18 billion possible values — plenty of headroom.
 * We check for collisions and reserved words.
 */

const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const HANDLE_LENGTH = 6;

/** Words that can't be used as handles (routes, subdomains, etc.) */
const RESERVED = new Set([
  "api", "admin", "app", "auth", "billing", "blog", "console",
  "docs", "dev", "help", "log", "login", "meter", "portal",
  "settings", "signup", "status", "support", "www",
]);

/** Generate a random handle string */
function randomHandle(): string {
  const bytes = crypto.randomBytes(HANDLE_LENGTH);
  let result = "";
  for (let i = 0; i < HANDLE_LENGTH; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
}

/**
 * Generate a unique user handle.
 *
 * @param checkExists - async fn that returns true if handle is already taken
 * @returns a unique 6-char alphanumeric handle
 */
export async function generateHandle(
  checkExists: (handle: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = randomHandle();
    if (RESERVED.has(candidate)) continue;
    if (!(await checkExists(candidate))) return candidate;
  }
  // Extremely unlikely fallback: use more bytes
  return crypto.randomBytes(8).toString("base64url").slice(0, 8).toLowerCase();
}
