"use server";

// Server actions for the login page. `signIn` throws a NEXT_REDIRECT on
// success (that must propagate) and an AuthError on failure (that we turn
// into an on-brand error message via the query string).

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { db } from "@/lib/db";

const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

/** Only allow same-site relative redirect targets. Everything else → /dashboard. */
function safeCallbackUrl(raw: FormDataEntryValue | null): string {
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/dashboard";
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"));
  try {
    await signIn("google", { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/login?error=${encodeURIComponent(error.type)}`);
    }
    throw error; // NEXT_REDIRECT and friends must propagate
  }
}

// Basic email shape without depending on zod's version-specific .email().
const requestEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(200)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "That's not an email address.");

/**
 * Invite-list request. While the app is in Google "testing" mode, people who
 * aren't test users can't sign in — they leave their Gmail here so the owner can
 * add them to the OAuth consent screen. Idempotent per email.
 */
export async function requestAccess(formData: FormData): Promise<void> {
  const parsed = requestEmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) redirect("/login?requestError=1");

  try {
    await db.accessRequest.upsert({
      where: { email: parsed.data },
      update: {}, // already on the list — leave their status as-is
      create: { email: parsed.data },
    });
  } catch (err) {
    console.error("[login] access request failed:", err);
    redirect("/login?requestError=1");
  }
  redirect("/login?requested=1");
}

export async function signInWithDev(formData: FormData): Promise<void> {
  if (process.env.DEV_LOGIN !== "true") {
    redirect("/login?error=AccessDenied");
  }
  const parsed = usernameSchema.safeParse(formData.get("username"));
  if (!parsed.success) {
    redirect("/login?error=BadUsername");
  }
  const redirectTo = safeCallbackUrl(formData.get("callbackUrl"));
  try {
    await signIn("dev", { username: parsed.data, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/login?error=${encodeURIComponent(error.type)}`);
    }
    throw error;
  }
}
