/**
 * Portal slug generation for hosted docs portal.
 *
 * Slugs are scoped per user (URL is /docs/{handle}/{slug}),
 * so they only need to be unique within a single user's workspaces.
 * No random suffixes — just a clean slug from the workspace name.
 *
 * Examples:
 *   "Conjure"        → "conjure"
 *   "My Cool App"    → "my-cool-app"
 *   "Startup Works"  → "startup-works"
 */

/** Convert a workspace name to a URL-safe slug */
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

/**
 * Generate a portal slug from a workspace name.
 * Since slugs are scoped per user, we just slugify the name directly.
 */
export function generatePortalSlug(name: string): string {
  return slugify(name);
}
