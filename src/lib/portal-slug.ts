/**
 * Portal slug generation for hosted docs portal.
 *
 * Strategy: derive a URL-friendly slug from the workspace name.
 * If the slug collides, transparently append a short alphanumeric suffix.
 * Users never see a "name taken" error — it just works.
 *
 * Examples:
 *   "Conjure"        → "conjure"
 *   "My Cool App"    → "my-cool-app"
 *   "Conjure" (dup)  → "conjure-a7k2"
 */

/** Convert a workspace name to a URL-safe base slug */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")   // strip non-alphanumeric
    .replace(/\s+/g, "-")            // spaces → hyphens
    .replace(/-+/g, "-")             // collapse multiple hyphens
    .replace(/^-|-$/g, "")           // trim leading/trailing hyphens
    || "workspace";                  // fallback if name is entirely non-ascii
}

/** Generate a short random suffix (4 alphanumeric chars) */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Generate a unique portal slug.
 * Checks the database for collisions and appends a suffix if needed.
 *
 * @param name - workspace display name
 * @param checkExists - async fn that returns true if slug is already taken
 * @returns a unique slug
 */
export async function generatePortalSlug(
  name: string,
  checkExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name);

  // Try the clean slug first
  if (!(await checkExists(base))) return base;

  // Append short suffixes until unique (max 5 attempts, then use longer id)
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${shortId()}`;
    if (!(await checkExists(candidate))) return candidate;
  }

  // Extremely unlikely fallback: timestamp-based
  return `${base}-${Date.now().toString(36)}`;
}
