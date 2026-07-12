// lib/classifier/index.ts — three-layer email classifier orchestrator.
//
// Layer 1: deterministic rules (no network) — classifyByRules.
// Layer 2: gemini-2.5-flash-lite structured output — classifyByLLM, only when
//          the rules abstain (null) AND GEMINI_API_KEY is set.
// Layer 3: graceful null — no key / API error → null; the caller records
//          nothing for that message (DESIGN.md §6 graceful degradation).

import type { ClassifiedEmail, EmailInput, LlmUsage } from "@/lib/types";
import { classifyByRules } from "./rules";
import { classifyByLLMTraced, usageCostUsd } from "./llm";

export { classifyByRules, ATS_DOMAINS, hasApplicationKeywords, isAtsDomain } from "./rules";
export { classifyByLLM, classifyByLLMTraced, usageCostUsd } from "./llm";
export { htmlToText } from "./strip";

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

/** A classification plus what it cost to get it. */
export interface TracedClassification {
  classification: ClassifiedEmail | null;
  /**
   * True when the LLM was actually invoked. A null classification alone can't
   * tell you this: the rules may simply have abstained with no key configured.
   * The billed-call count is the difference.
   */
  llmCalled: boolean;
  /** Tokens billed for this message (zero when the rules handled it). */
  usage: LlmUsage;
  /** Those tokens in dollars. */
  costUsd: number;
}

/**
 * Classify one email, reporting what it cost. Rules first (free, no network); if
 * the rules abstain and a Gemini API key is configured, fall back to the LLM;
 * otherwise (or on LLM failure) the classification is null.
 */
export async function classifyEmailTraced(input: EmailInput): Promise<TracedClassification> {
  const ruled = classifyByRules(input);
  if (ruled) return { classification: ruled, llmCalled: false, usage: NO_USAGE, costUsd: 0 };

  if (!process.env.GEMINI_API_KEY) {
    return { classification: null, llmCalled: false, usage: NO_USAGE, costUsd: 0 };
  }

  // Billed from here on, whatever comes back.
  const { classification, usage } = await classifyByLLMTraced(input);
  return { classification, llmCalled: true, usage, costUsd: usageCostUsd(usage) };
}

/** Classification only, for callers that don't care what it cost. */
export async function classifyEmail(input: EmailInput): Promise<ClassifiedEmail | null> {
  return (await classifyEmailTraced(input)).classification;
}
