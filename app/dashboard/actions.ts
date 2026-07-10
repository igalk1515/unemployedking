"use server";

// Dashboard server actions. The proxy already guards /dashboard, but per
// Next 16 guidance every server action re-verifies auth() itself.
// Manual entries are sacred: source="manual" marks human intent that the
// email pipeline must never overwrite (Data rule 3).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { MAX_AUTO_SYNC_INTERVAL_DAYS } from "@/lib/gmail/autoSync";
import { MAX_BACKFILL_WINDOW_DAYS } from "@/lib/gmail/sync";
import { HIDEABLE_PROFILE_FIELDS } from "@/lib/types";

const DAY_MS = 86_400_000;

const manualEntrySchema = z.object({
  company: z
    .string()
    .trim()
    .min(1, "A company name is required. Even “that startup with the beanbags” counts.")
    .max(120, "Company name too long. Nobody rejects that verbosely."),
  role: z.string().trim().max(120, "Role title too long. Simplify, like they simplified your future.").optional(),
  appliedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an actual date. The calendar is not optional."),
  status: z.enum(["applied", "rejected", "ghosted", "interview", "offer"]),
});

/** Redirect back to the dashboard with a banner message in the query string. */
function backToDashboard(params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(`/dashboard${query ? `?${query}` : ""}`);
}

export async function addManualApplication(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=/dashboard");

  const parsed = manualEntrySchema.safeParse({
    company: formData.get("company"),
    role: formData.get("role") ?? undefined,
    appliedOn: formData.get("appliedOn"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    backToDashboard({
      error:
        parsed.error.issues[0]?.message ??
        "That form got auto-rejected in under a second. Try again.",
    });
  }

  const { company, status } = parsed.data;
  const role = parsed.data.role ? parsed.data.role : null;

  const appliedAt = new Date(`${parsed.data.appliedOn}T00:00:00.000Z`);
  if (Number.isNaN(appliedAt.getTime())) {
    backToDashboard({ error: "That date does not exist. Genuinely impressive." });
  }

  const now = new Date();
  // +1 day of tolerance so "today" in timezones ahead of UTC still passes.
  if (appliedAt.getTime() > now.getTime() + DAY_MS) {
    backToDashboard({
      error: "We track rejections, not prophecies. Pick a date that already happened.",
    });
  }

  // The outcome is recorded now, but never before the application itself.
  const outcomeAt = new Date(Math.max(now.getTime(), appliedAt.getTime() + 60_000));

  try {
    await db.application.create({
      data: {
        userId,
        company,
        companyNormalized: company.toLowerCase(),
        role,
        source: "manual",
        appliedAt,
        events: {
          create: [
            {
              userId,
              type: "applied",
              source: "manual",
              confidence: "high",
              occurredAt: appliedAt,
            },
            ...(status !== "applied"
              ? [
                  {
                    userId,
                    type: status,
                    source: "manual",
                    confidence: "high",
                    occurredAt: outcomeAt,
                  },
                ]
              : []),
          ],
        },
      },
    });
  } catch (err) {
    console.error("[dashboard] manual application add failed:", err);
    backToDashboard({
      error: "The database rejected your application too. Poetic. Try again.",
    });
  }

  revalidatePath("/dashboard");
  backToDashboard({ added: company });
}

// The server owns the lookback bound; the dashboard <select> is only a
// convenience. A crafted POST past the cap is rejected here, not in the UI.
const syncSettingsSchema = z.object({
  backfillWindowDays: z.coerce
    .number()
    .int()
    .min(1, "The window has to be at least a day.")
    .max(MAX_BACKFILL_WINDOW_DAYS, "Two years is the ceiling. The past is a trap."),
});

export async function updateSyncSettings(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=/dashboard");

  const parsed = syncSettingsSchema.safeParse({
    backfillWindowDays: formData.get("backfillWindowDays"),
  });
  if (!parsed.success) {
    backToDashboard({
      error:
        parsed.error.issues[0]?.message ??
        "That is not a real amount of time. Two years max. The past is a trap.",
    });
  }
  const days = parsed.data.backfillWindowDays;

  const current = await db.user.findUnique({
    where: { id: userId },
    select: { backfillWindowDays: true },
  });
  await db.user.update({ where: { id: userId }, data: { backfillWindowDays: days } });

  // Deepening the window means older mail we have never seen exists — re-arm
  // the backfill so the next sync digs to the new depth (idempotency makes
  // the already-covered stretch a cheap skip).
  if (current && days > current.backfillWindowDays) {
    await db.emailAccount.updateMany({
      where: { userId },
      data: { backfillDone: false },
    });
  }

  revalidatePath("/dashboard");
  backToDashboard({ saved: String(days) });
}

// Auto-sync cadence: how often the cron re-checks this user's inbox. The <select>
// offers off / 1 / 7 / custom, but the server owns the bounds — a crafted POST
// with a wild "custom" value is clamped and rejected here, not in the UI.
const customIntervalSchema = z.coerce
  .number()
  .int()
  .min(1, "The cadence has to be at least 1 day.")
  .max(
    MAX_AUTO_SYNC_INTERVAL_DAYS,
    `${MAX_AUTO_SYNC_INTERVAL_DAYS} days is the ceiling. Any rarer and it's basically manual.`,
  );

export async function updateAutoSync(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=/dashboard");

  const preset = formData.get("preset");
  let intervalDays: number | null;

  if (preset === "off") {
    intervalDays = null;
  } else if (preset === "1" || preset === "7") {
    intervalDays = Number(preset);
  } else if (preset === "custom") {
    const parsed = customIntervalSchema.safeParse(formData.get("customDays"));
    if (!parsed.success) {
      backToDashboard({
        error: parsed.error.issues[0]?.message ?? "That is not a real cadence.",
      });
    }
    intervalDays = parsed.data;
  } else {
    backToDashboard({ error: "Pick a real auto-sync option." });
  }

  await db.user.update({
    where: { id: userId },
    data: { autoSyncIntervalDays: intervalDays },
  });

  revalidatePath("/dashboard");
  backToDashboard({ autosync: intervalDays === null ? "off" : String(intervalDays) });
}

const nicknameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(40, "Nicknames cap at 40 characters. Mystery is fine, essays aren't.")
    .refine(
      (v) => v.length === 0 || v.length >= 2,
      "At least 2 characters, or leave it blank to use your handle.",
    ),
});

/**
 * Set a public nickname (displayName). Pseudonyms are the point: nobody has to
 * ship their real name to get ranked. Blank clears it back to the handle/slug.
 */
export async function updateDisplayName(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=/dashboard");

  const parsed = nicknameSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
  });
  if (!parsed.success) {
    backToDashboard({
      error:
        parsed.error.issues[0]?.message ??
        "That nickname got auto-rejected. On brand, honestly.",
    });
  }

  const trimmed = parsed.data.displayName;
  const displayName = trimmed.length > 0 ? trimmed : null;

  const user = await db.user.update({
    where: { id: userId },
    data: { displayName },
    select: { slug: true },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/u/${user.slug}`);
  backToDashboard({ renamed: displayName ?? "" });
}

/**
 * Privacy & visibility: whether the public profile exists at all, whether the
 * user appears on the leaderboard, and which individual profile fields are
 * hidden. Checkboxes are absent from FormData when unchecked, so presence ==
 * checked. The server owns the field allow-list: only recognized keys from
 * HIDEABLE_PROFILE_FIELDS are stored, so a crafted POST can't smuggle junk in.
 */
export async function updatePrivacy(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=/dashboard");

  const publicProfile = formData.get("publicProfile") === "on";
  const leaderboardOptIn = formData.get("leaderboardOptIn") === "on";
  const hidden = HIDEABLE_PROFILE_FIELDS.filter(
    (field) => formData.get(`hide:${field}`) === "on",
  );

  const user = await db.user.update({
    where: { id: userId },
    data: {
      publicProfile,
      leaderboardOptIn,
      hiddenProfileFields: hidden.join(","),
    },
    select: { slug: true },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/u/${user.slug}`);
  backToDashboard({ privacy: publicProfile ? "public" : "private" });
}

/**
 * Owner-only: clear the pending access-request list after the owner has pasted
 * those emails into the Google OAuth test-user list. Marks all pending → added
 * so only genuinely new requests remain visible.
 */
export async function markRequestsAdded(): Promise<void> {
  const session = await auth();
  const email = session?.user?.email;
  const owner = process.env.OWNER_EMAIL;
  if (!email || !owner || email.toLowerCase() !== owner.toLowerCase()) {
    redirect("/dashboard");
  }
  await db.accessRequest.updateMany({
    where: { status: "pending" },
    data: { status: "added" },
  });
  revalidatePath("/dashboard");
  redirect("/dashboard?requestsCleared=1");
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
