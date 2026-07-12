// lib/classifier/llm.ts — Layer 2 of the email classifier.
// Structured JSON output via the Google Gen AI SDK (gemini-2.5-flash-lite):
// responseMimeType "application/json" + a responseSchema, then validated with
// the same zod schema the rest of the pipeline speaks.
//
// Failure policy (DESIGN.md §4.3): missing GEMINI_API_KEY or any API / parse
// error → return null. The sync loop records nothing for that message — fail
// safe, never fail loud. Errors are logged (never silently swallowed) but never
// thrown.

import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { ClassifiedEmail, EmailInput, LlmUsage } from "@/lib/types";

const MODEL = "gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 512;
const BODY_TRUNCATE_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * gemini-2.5-flash-lite list price, USD per 1M tokens (ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-07-12). Override via env when the price changes or you move tiers —
 * the free tier is $0, so set both to 0 to stop counting phantom spend.
 */
const USD_PER_1M_INPUT = Number(process.env.GEMINI_USD_PER_1M_INPUT ?? 0.1);
const USD_PER_1M_OUTPUT = Number(process.env.GEMINI_USD_PER_1M_OUTPUT ?? 0.4);

/** What one call cost, from the token counts Gemini itself reports. */
export function usageCostUsd(usage: LlmUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * USD_PER_1M_INPUT +
    (usage.outputTokens / 1_000_000) * USD_PER_1M_OUTPUT
  );
}

/** Mirrors ClassifiedEmail minus `layer` (which this module stamps as "llm"). */
const classificationSchema = z.object({
  event: z.enum(["applied_confirmation", "rejection", "interview_invite", "offer", "other"]),
  company: z.string().nullable(),
  role: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

// The same shape expressed as a Gemini responseSchema. Keep in lock-step with
// classificationSchema above — the model is constrained to this, and the zod
// schema then re-validates what comes back.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    event: {
      type: Type.STRING,
      enum: ["applied_confirmation", "rejection", "interview_invite", "offer", "other"],
    },
    company: { type: Type.STRING, nullable: true },
    role: { type: Type.STRING, nullable: true },
    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
  },
  required: ["event", "company", "role", "confidence"],
  propertyOrdering: ["event", "company", "role", "confidence"],
};

const SYSTEM_PROMPT = `You classify job-search-related emails for an application tracker. Given one email (From header, subject, body), return the structured classification.

Event definitions:
- "applied_confirmation": the sender confirms THIS applicant's application was received/submitted.
- "rejection": an explicit decision NOT to proceed with THIS applicant's specific application. A rejection must be about this person's own candidacy — a generic "the position has been closed/filled" announcement sent to a mailing list, a news item, or a status digest is NOT a rejection; classify those as "other". Rejections may be in any language (e.g. Hebrew).
- "interview_invite": the sender invites THIS applicant to interview, schedule a call, or book a time as part of an active application process.
- "offer": a job offer or offer letter for THIS applicant.
- "other": everything else. This explicitly includes: job-alert digests and job recommendations ("jobs for you", "new jobs matching your profile"), "your application was viewed" / "your profile was viewed" notices, recruiter cold outreach about new opportunities the person never applied to, newsletters and marketing, and generic position-closed announcements.

Fields:
- company: the employer the application is with (NOT the ATS vendor like Greenhouse/Lever/Workday, and NOT a job board). null when not identifiable.
- role: the job title if stated, else null.
- confidence: "high" only when the email is unambiguous about the event AND clearly about this applicant's own application; "medium" when likely but partly inferred; "low" when it is a guess.

Return only the structured object.`;

let cachedClient: GoogleGenAI | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  }
  return cachedClient;
}

function normalizeField(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed || /^(?:null|none|unknown|n\/a)$/i.test(trimmed)) return null;
  return trimmed;
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

/** Classification plus the token usage Gemini reported (billed either way). */
export interface TracedLlmResult {
  classification: ClassifiedEmail | null;
  usage: LlmUsage;
}

/**
 * Classify an email with gemini-2.5-flash-lite, reporting token usage.
 *
 * Usage is captured even when the classification is null (empty response, schema
 * violation): those calls are billed all the same, and pretending they were free
 * is how an LLM bill surprises you. Only a call that never reached the API
 * (missing key, transport error) reports zero.
 */
export async function classifyByLLMTraced(input: EmailInput): Promise<TracedLlmResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { classification: null, usage: NO_USAGE };

  const body =
    input.bodyText.length > BODY_TRUNCATE_CHARS
      ? `${input.bodyText.slice(0, BODY_TRUNCATE_CHARS)}\n[truncated]`
      : input.bodyText;

  try {
    const response = await getClient(apiKey).models.generateContent({
      model: MODEL,
      contents: `From: ${input.from}\nSubject: ${input.subject}\nReceived: ${input.receivedAt.toISOString()}\n\nBody:\n${body}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
      },
    });

    // Thinking tokens bill as output, so fold them in rather than under-report.
    const meta = response.usageMetadata;
    const usage: LlmUsage = {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    };

    const text = response.text;
    if (!text) {
      console.warn(
        `[classifier/llm] empty response (finishReason=${response.candidates?.[0]?.finishReason}) — skipping message`,
      );
      return { classification: null, usage };
    }

    const parsed = classificationSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.warn(`[classifier/llm] output failed schema validation — skipping message`);
      return { classification: null, usage };
    }

    return {
      classification: {
        event: parsed.data.event,
        company: normalizeField(parsed.data.company),
        role: normalizeField(parsed.data.role),
        confidence: parsed.data.confidence,
        layer: "llm",
      },
      usage,
    };
  } catch (error) {
    // Fail safe: the sync loop must keep going; this message is just skipped.
    // No usageMetadata came back, so we can't attribute a cost to this call.
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[classifier/llm] classification failed: ${detail}`);
    return { classification: null, usage: NO_USAGE };
  }
}

/** Classification only, for callers that don't care what it cost. */
export async function classifyByLLM(input: EmailInput): Promise<ClassifiedEmail | null> {
  return (await classifyByLLMTraced(input)).classification;
}
