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

/**
 * Classify one email. Rules first; if the rules abstain and a Gemini API key
 * is configured, fall back to the LLM; otherwise (or on LLM failure) return
 * null.
 */
export async function classifyEmail(input: EmailInput): Promise<ClassifiedEmail | null> {
  const ruled = classifyByRules(input);
  if (ruled) return ruled;

  if (!process.env.GEMINI_API_KEY) return null;

  return classifyByLLM(input);
}
