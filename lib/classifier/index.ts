// lib/classifier/index.ts — three-layer email classifier orchestrator.
//
// Layer 1: deterministic rules (no network) — classifyByRules.
// Layer 2: gemini-2.5-flash-lite structured output — classifyByLLM, only when
//          the rules abstain (null) AND GEMINI_API_KEY is set.
// Layer 3: graceful null — no key / API error → null; the caller records
//          nothing for that message (DESIGN.md §6 graceful degradation).

import type { ClassifiedEmail, EmailInput } from "@/lib/types";
import { classifyByRules } from "./rules";
import { classifyByLLM } from "./llm";

export { classifyByRules, ATS_DOMAINS, hasApplicationKeywords, isAtsDomain } from "./rules";
export { classifyByLLM } from "./llm";
export { htmlToText } from "./strip";

/** A classification plus whether it cost us a (billed) Gemini call. */
export interface TracedClassification {
  classification: ClassifiedEmail | null;
  /**
   * True when the LLM was actually invoked. A null classification alone can't
   * tell you this: the rules may simply have abstained with no key configured.
   * The billed-call count is the difference.
   */
  llmCalled: boolean;
}

/**
 * Classify one email, reporting whether the LLM was billed. Rules first; if the
 * rules abstain and a Gemini API key is configured, fall back to the LLM;
 * otherwise (or on LLM failure) the classification is null.
 */
export async function classifyEmailTraced(input: EmailInput): Promise<TracedClassification> {
  const ruled = classifyByRules(input);
  if (ruled) return { classification: ruled, llmCalled: false };

  if (!process.env.GEMINI_API_KEY) return { classification: null, llmCalled: false };

  // Billed from here on, whatever comes back.
  return { classification: await classifyByLLM(input), llmCalled: true };
}

/** Classification only, for callers that don't care what it cost. */
export async function classifyEmail(input: EmailInput): Promise<ClassifiedEmail | null> {
  return (await classifyEmailTraced(input)).classification;
}
