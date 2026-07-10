// Unique, URL-safe public slugs (Riot-ID-style pseudonyms) for User rows.

import { db } from "@/lib/db";

const FALLBACK_BASE = "royal-applicant";
const MAX_BASE_LENGTH = 32;
const MAX_NUMERIC_ATTEMPTS = 500;

/** Lowercase, strip diacritics, collapse everything non-alphanumeric to single dashes. */
function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics left over from NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, "");
  return slug || FALLBACK_BASE;
}

/**
 * Turn an arbitrary base string (usually the email local-part) into a slug that
 * is unique among users: `jane.doe` -> `jane-doe`, then `jane-doe-2`, `jane-doe-3`, ...
 *
 * Uniqueness is checked against the DB in a single query; the `User.slug` unique
 * constraint remains the final referee under concurrent sign-ups (callers should
 * retry on a unique-constraint violation).
 */
export async function makeUniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  const collisions = await db.user.findMany({
    where: { OR: [{ slug: root }, { slug: { startsWith: `${root}-` } }] },
    select: { slug: true },
  });
  const taken = new Set(collisions.map((u) => u.slug));

  if (!taken.has(root)) return root;
  for (let n = 2; n <= MAX_NUMERIC_ATTEMPTS; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // ~500 people share this name? The job market really is crowded.
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}
