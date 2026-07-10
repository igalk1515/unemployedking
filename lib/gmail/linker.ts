// lib/gmail/linker.ts — attach classified emails to Applications and persist
// append-only Events.
//
// Linking order (DESIGN.md §4.4):
//   (1) Application with the same gmailThreadId
//   (2) applied_confirmation with no thread match → create Application + applied event
//   (3) other events → fuzzy company match (single match attaches, else orphan)
//
// Data-rule guardrails honored here:
//   - Rule 1: events are only ever created, never updated/deleted — with one
//     narrow exception: a freshly created Application adopts orphan events
//     from its own Gmail thread (linkage metadata only; the event content is
//     untouched). Without adoption, a rejection processed before its
//     confirmation would stay orphaned forever.
//   - Rule 3: medium/low confidence email events never auto-attach to an
//     application that has any manual event — they land unattached instead.
//   - Rule 5: Event.gmailMessageId is unique; a concurrent duplicate insert is
//     swallowed as a no-op.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deriveStatus } from "@/lib/stats/status";
import type { ClassifiedEmail, Confidence, EventType } from "@/lib/types";

const EVENT_TYPE_BY_CLASSIFICATION: Record<
  Exclude<ClassifiedEmail["event"], "other">,
  EventType
> = {
  applied_confirmation: "applied",
  rejection: "rejected",
  interview_invite: "interview",
  offer: "offer",
};

export interface LinkMeta {
  messageId: string;
  threadId: string;
  senderDomain: string;
  receivedAt: Date;
}

/**
 * Link a classified email to the right Application (or create one, or leave
 * the event orphaned) and persist the Event. Idempotent per gmailMessageId.
 */
export async function linkAndPersist(
  userId: string,
  cls: ClassifiedEmail,
  meta: LinkMeta,
): Promise<{ createdApplication: boolean; createdEvent: boolean }> {
  if (cls.event === "other") return { createdApplication: false, createdEvent: false };
  const eventType = EVENT_TYPE_BY_CLASSIFICATION[cls.event];

  // (1) Thread anchor — an ATS replying in the same thread is the strongest link.
  const threadApp = meta.threadId
    ? await db.application.findFirst({
        where: { userId, gmailThreadId: meta.threadId },
        select: { id: true, events: { select: { source: true } } },
      })
    : null;

  if (threadApp) {
    const applicationId = canAutoAttach(cls.confidence, threadApp.events)
      ? threadApp.id
      : null;
    const createdEvent = await createEvent(userId, applicationId, eventType, cls.confidence, meta);
    return { createdApplication: false, createdEvent };
  }

  // (2) A confirmation with no thread match births a new Application.
  if (cls.event === "applied_confirmation") {
    return createApplicationWithEvent(userId, cls, eventType, meta);
  }

  // (3) Fuzzy company match for rejection / interview / offer.
  const target = cls.company ? await findFuzzyTarget(userId, cls.company) : null;
  if (target) {
    const applicationId = canAutoAttach(cls.confidence, target.events) ? target.id : null;
    const createdEvent = await createEvent(userId, applicationId, eventType, cls.confidence, meta);
    return { createdApplication: false, createdEvent };
  }

  // (3b) A forward-progress event (interview/offer) for a company with no
  //   *single* clean match. If the company is tracked at all (even ambiguously,
  //   across threads), attach to its most-recently-active application so a
  //   multi-thread pipeline (calendar invites, reminders, e-sign offers)
  //   coalesces onto one app; only mint when the company is genuinely new so it
  //   becomes visible instead of an orphan. Rejections never mint: a stray
  //   "regret to inform" with no prior application is likelier stale noise.
  if (cls.company && (cls.event === "interview_invite" || cls.event === "offer")) {
    const existing = await findBestFuzzyMatch(userId, cls.company);
    if (existing) {
      const applicationId = canAutoAttach(cls.confidence, existing.events) ? existing.id : null;
      const createdEvent = await createEvent(userId, applicationId, eventType, cls.confidence, meta);
      return { createdApplication: false, createdEvent };
    }
    return createApplicationWithEvent(userId, cls, eventType, meta);
  }

  const createdEvent = await createEvent(userId, null, eventType, cls.confidence, meta);
  return { createdApplication: false, createdEvent };
}

// ---------------------------------------------------------------------------
// Manual-intent protection (Data rule 3)
// ---------------------------------------------------------------------------

function canAutoAttach(confidence: Confidence, events: { source: string }[]): boolean {
  if (confidence === "high") return true;
  return !events.some((e) => e.source === "manual");
}

// ---------------------------------------------------------------------------
// Fuzzy company matching
// ---------------------------------------------------------------------------

/** Schema-faithful normalization: lowercase, trim, collapse whitespace. */
function normalizeCompany(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Aggressive form for containment checks: letters and digits only. */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function fuzzyCompanyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = squash(a);
  const sb = squash(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  // Containment only for names long enough to not match everything ("AI"…).
  if (sa.length >= 3 && sb.length >= 3) return sa.includes(sb) || sb.includes(sa);
  return false;
}

interface FuzzyCandidate {
  id: string;
  companyNormalized: string;
  events: { type: string; occurredAt: Date; source: string }[];
}

function lastEventMs(a: FuzzyCandidate): number {
  return a.events.reduce((max, e) => Math.max(max, e.occurredAt.getTime()), 0);
}

/**
 * Fuzzy-company candidates for the user: normalized equality or
 * one-contains-the-other, preferring applications without a terminal derived
 * status (rejected/offer — ghosted stays attachable: that's how Necromancer
 * cases happen).
 */
async function fuzzyPool(userId: string, company: string): Promise<FuzzyCandidate[]> {
  const wanted = normalizeCompany(company);
  if (!wanted) return [];

  const apps: FuzzyCandidate[] = await db.application.findMany({
    where: { userId },
    select: {
      id: true,
      companyNormalized: true,
      events: { select: { type: true, occurredAt: true, source: true } },
    },
  });

  const matches = apps.filter((a) => fuzzyCompanyMatch(a.companyNormalized, wanted));
  if (matches.length === 0) return [];

  const open = matches.filter((a) => {
    const status = deriveStatus(a.events);
    return status !== "rejected" && status !== "offer";
  });
  return open.length > 0 ? open : matches;
}

/** Exactly one candidate → attach; ambiguous or none → null (orphan the event). */
async function findFuzzyTarget(userId: string, company: string): Promise<FuzzyCandidate | null> {
  const pool = await fuzzyPool(userId, company);
  return pool.length === 1 ? pool[0] : null;
}

/**
 * Best candidate even when ambiguous: the most recently active application.
 * Used by the interview/offer mint path so a multi-thread pipeline coalesces
 * onto one application instead of spawning a duplicate per thread.
 */
async function findBestFuzzyMatch(userId: string, company: string): Promise<FuzzyCandidate | null> {
  const pool = await fuzzyPool(userId, company);
  if (pool.length === 0) return null;
  return pool.reduce((best, a) => (lastEventMs(a) > lastEventMs(best) ? a : best));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Insert one email-sourced Event. Returns false if the message was already recorded. */
async function createEvent(
  userId: string,
  applicationId: string | null,
  type: EventType,
  confidence: Confidence,
  meta: LinkMeta,
): Promise<boolean> {
  try {
    await db.event.create({
      data: {
        userId,
        applicationId,
        type,
        source: "email",
        confidence,
        occurredAt: meta.receivedAt,
        gmailMessageId: meta.messageId,
        gmailThreadId: meta.threadId || null,
        senderDomain: meta.senderDomain || null,
      },
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function createApplicationWithEvent(
  userId: string,
  cls: ClassifiedEmail,
  eventType: EventType,
  meta: LinkMeta,
): Promise<{ createdApplication: boolean; createdEvent: boolean }> {
  const company = (cls.company ?? "").trim() || companyFromDomain(meta.senderDomain);
  try {
    await db.$transaction(async (tx) => {
      const app = await tx.application.create({
        data: {
          userId,
          company,
          companyNormalized: normalizeCompany(company),
          role: cls.role?.trim() || null,
          source: "email",
          gmailThreadId: meta.threadId || null,
          appliedAt: meta.receivedAt,
        },
      });
      // Adopt orphan events from the same thread — e.g. a rejection that was
      // processed before this confirmation existed (linkage only; see the
      // Rule 1 note at the top of this file).
      if (meta.threadId) {
        await tx.event.updateMany({
          where: { userId, applicationId: null, gmailThreadId: meta.threadId },
          data: { applicationId: app.id },
        });
      }
      await tx.event.create({
        data: {
          userId,
          applicationId: app.id,
          type: eventType,
          source: "email",
          confidence: cls.confidence,
          occurredAt: meta.receivedAt,
          gmailMessageId: meta.messageId,
          gmailThreadId: meta.threadId || null,
          senderDomain: meta.senderDomain || null,
        },
      });
    });
    return { createdApplication: true, createdEvent: true };
  } catch (err) {
    // Unique gmailMessageId collision rolls the whole transaction back:
    // another worker already recorded this message. No-op.
    if (isUniqueViolation(err)) return { createdApplication: false, createdEvent: false };
    throw err;
  }
}

/** "hire.lever.co" → "Lever"; "us.greenhouse-mail.io" → "Greenhouse". Last resort. */
function companyFromDomain(senderDomain: string): string {
  const skip = new Set([
    "mail",
    "email",
    "boards",
    "jobs",
    "careers",
    "hire",
    "apply",
    "talent",
    "notifications",
    "noreply",
    "no-reply",
    "us",
    "eu",
    "app",
    "www",
  ]);
  const labels = senderDomain.toLowerCase().split(".").filter(Boolean);
  let core = labels.find((label) => !skip.has(label)) ?? labels[0] ?? "";
  core = core.replace(/-?mail$/, "").replace(/-/g, " ").trim();
  if (!core) return senderDomain || "Unknown Company";
  return core
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
