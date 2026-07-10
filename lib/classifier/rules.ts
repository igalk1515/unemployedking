// lib/classifier/rules.ts — deterministic Layer 1 of the email classifier.
// No network, no dependencies beyond lib/types. Exported for tests
// (scripts/classifier-check.ts exercises classifyByRules directly).
//
// Contract (DESIGN.md §4.3):
//   1. NEVER-signals (job alerts, "application viewed" noise, job boards)
//      → { event: "other" } immediately, before any other check.
//   2. Phrase banks: REJECTION → APPLIED → INTERVIEW → OFFER, matched
//      case-insensitively on subject+body.
//   3. Company extraction from subject patterns, else ATS sender display name.
//   4. Nothing matched + ATS sender → null (LLM decides).
//      Nothing matched + non-ATS + subject has application keywords → null.
//      Nothing matched + non-ATS + no application keywords → other/low.

import type { ClassifiedEmail, Confidence, EmailInput } from "@/lib/types";

/** Known ATS sender domains. Matched as exact domain or any subdomain. */
export const ATS_DOMAINS: string[] = [
  "greenhouse-mail.io",
  "greenhouse.io",
  "hire.lever.co",
  "lever.co",
  "myworkday.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "comeet.co",
  "bamboohr.com",
  "teamtailor.com",
  "workablemail.com",
  "workable.com",
  "jobvite.com",
  "recruitee.com",
  "breezy.hr",
  "taleo.net",
];

// ---------------------------------------------------------------------------
// Sender parsing
// ---------------------------------------------------------------------------

interface ParsedSender {
  displayName: string | null;
  address: string | null;
  domain: string | null;
  localPart: string | null;
}

/** Parse a From header like `Acme Careers <no-reply@us.greenhouse-mail.io>`. */
function parseSender(from: string): ParsedSender {
  const header = (from ?? "").trim();
  let displayName: string | null = null;
  let address: string | null = null;

  const angled = header.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angled) {
    displayName = angled[1].trim().replace(/^["']+|["']+$/g, "").trim() || null;
    address = angled[2].trim();
  } else {
    const bare = header.match(/([^\s<>"']+@[^\s<>"']+)/);
    if (bare) address = bare[1];
  }

  if (!address) return { displayName, address: null, domain: null, localPart: null };

  const at = address.lastIndexOf("@");
  const localPart = address.slice(0, at).toLowerCase();
  const domain = address
    .slice(at + 1)
    .toLowerCase()
    .replace(/[>.,;\s]+$/, "");

  return { displayName, address, domain, localPart };
}

function domainMatches(senderDomain: string, candidate: string): boolean {
  return senderDomain === candidate || senderDomain.endsWith("." + candidate);
}

/**
 * True when the sender domain is (a subdomain of) a known ATS domain.
 * Exported for the sync candidate gate (lib/gmail/sync.ts).
 */
export function isAtsDomain(domain: string | null): boolean {
  if (!domain) return false;
  return ATS_DOMAINS.some((ats) => domainMatches(domain, ats));
}

// ---------------------------------------------------------------------------
// NEVER-signals — job boards, alert digests, "application viewed" noise.
// Sender-based checks use sender+subject; phrase checks use the subject only
// (bodies/footers routinely mention "job alerts" in unsubscribe blurbs, which
// must NOT flip a real ATS email to "other").
// ---------------------------------------------------------------------------

const NEVER_SUBJECT_PATTERNS: RegExp[] = [
  /job alert/i,
  /jobs? for you/i,
  /new jobs? matching/i,
  /application (?:was |has been )?viewed/i,
  /(?:profile|resume) (?:was |has been )?view/i,
];

function isNeverSignal(sender: ParsedSender, subject: string): boolean {
  const { domain, localPart } = sender;

  if (domain) {
    // LinkedIn job-alert / notification machinery (jobs-noreply, jobalerts).
    if (
      domainMatches(domain, "linkedin.com") &&
      localPart !== null &&
      /jobs?-?noreply|job-?alerts?/i.test(localPart)
    ) {
      return true;
    }
    // Indeed alert digests ("alert@indeed.com" and friends).
    if (
      (domainMatches(domain, "indeed.com") || domainMatches(domain, "indeedemail.com")) &&
      localPart !== null &&
      /alert|donotreply|no-?reply|invitetoapply|match/i.test(localPart)
    ) {
      return true;
    }
    // Glassdoor is a review/alert site — never an ATS decision channel.
    if (domainMatches(domain, "glassdoor.com")) {
      return true;
    }
  }

  return NEVER_SUBJECT_PATTERNS.some((re) => re.test(subject));
}

// ---------------------------------------------------------------------------
// Phrase banks (case-insensitive; matched against subject + body)
// ---------------------------------------------------------------------------

const REJECTION_PATTERNS: RegExp[] = [
  /decided to move forward with other candidates/i,
  /will not be moving forward/i,
  /(?:decided|chosen) not to move forward/i,
  /decided to pursue other candidates/i,
  /we regret to inform you/i,
  /your application was not selected/i,
  /decided to go in a different direction/i,
  /chosen to proceed with other applicants/i,
  /position has been filled/i,
  // Workday-style boilerplate: "…unfortunately, at this time we have decided…"
  /unfortunately,? at this time we/i,
  // Hebrew rejections (comeet & friends): "unfortunately we decided to move
  // forward with other candidates" and common variants.
  /להתקדם עם מועמדים אחרים/,
  /להמשיך עם מועמדים אחרים/,
  /לא נוכל להמשיך בתהליך/,
];

/** "unfortunately" + ("your application" | "your candidacy") — both required. */
function isCompoundRejection(text: string): boolean {
  return /unfortunately/i.test(text) && /your (?:application|candidacy)/i.test(text);
}

const APPLIED_PATTERNS: RegExp[] = [
  /thank you for applying/i,
  /thanks for applying/i,
  /thank(?:s| you) for your application/i,
  /we(?:'ve| have) received your application/i,
  /your application (?:was|has been) (?:received|submitted)/i,
  /application confirmation/i,
];

/** Explicitly about interviewing — safe to fire from any sender. */
const INTERVIEW_EXPLICIT_PATTERNS: RegExp[] = [
  /schedule (?:a|your) (?:call|interview)/i,
  /invite you to interview/i,
  /interview invitation/i,
  /interview confirmation/i,
  /upcoming interview/i,
  // "Interview with {Company}" — reminder mail and Google Calendar event titles.
  /\binterview with\b/i,
];

/**
 * Generic scheduling/chat phrases — Calendly sales blasts use these too, so
 * they only count when the mail smells like an application (ATS sender or
 * application-flavored subject).
 */
const INTERVIEW_GENERIC_PATTERNS: RegExp[] = [
  /book a time/i,
  /would love to (?:chat|speak|meet)/i,
];

/**
 * "Offer letter" is mortgage/real-estate vocabulary too — the whole bank is
 * gated on application smell, same as INTERVIEW_GENERIC_PATTERNS.
 */
const OFFER_PATTERNS: RegExp[] = [
  /pleased to offer you/i,
  /offer letter/i,
  /extend (?:you )?an offer/i,
  /offer to join/i,
  /offer of employment/i,
  /(?:excited|thrilled|delighted|happy|glad|pleased) to (?:formally |officially )?offer/i,
  /we(?:'d| would) (?:like|love) to offer/i,
];

/** Subject keywords that make a non-ATS email worth an LLM look. */
const APPLICATION_KEYWORD_PATTERN =
  /applicat|candidac|candidate|interview|position\b|\brole\b|offer|recruit|hiring|מועמד|משרה|ראיון/i;

/**
 * True when the subject mentions anything application-shaped. Exported for
 * the sync candidate gate — mirrors BACKFILL_QUERY semantics client-side.
 */
export function hasApplicationKeywords(subject: string): boolean {
  return APPLICATION_KEYWORD_PATTERN.test(subject);
}

// ---------------------------------------------------------------------------
// Company extraction
// ---------------------------------------------------------------------------

const COMPANY_SUBJECT_PATTERNS: RegExp[] = [
  /your application (?:to|at|with) (.+?)(?:\s+[-–—|]|[!?.,;:]|$)/i,
  /thank you for applying (?:to|at) (.+?)(?:\s+[-–—|]|[!?.,;:]|$)/i,
  /update on your application (?:at|to|with) (.+?)(?:\s+[-–—|]|[!?.,;:]|$)/i,
  /offer to join (.+?)(?:\s+[-–—|]|[!?.,;:]|$)/i,
  // "Interview with {Company} @ Wed Mar 18" — stop at a calendar "@" too.
  /interview with (.+?)(?:\s+@|\s+[-–—|]|[!?.,;:]|$)/i,
];

/** Display names that are just the ATS product, not the employer. */
const ATS_BRAND_NAMES =
  /^(?:greenhouse|lever|workday|ashby(?:hq)?|smart\s?recruiters|icims|comeet|bamboo\s?hr|team\s?tailor|workable|jobvite|recruitee|breezy(?:\s?hr)?|taleo|no-?reply|notifications?)$/i;

function cleanCompany(raw: string): string | null {
  let company = raw.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  // Strip common recruiting-team suffixes: "Initech Careers" → "Initech".
  company = company
    .replace(/\s+(?:careers?|recruiting(?:\s+team)?|hiring\s+team|talent(?:\s+(?:team|acquisition))?|team)$/i, "")
    .trim();
  if (!company || ATS_BRAND_NAMES.test(company)) return null;
  return company;
}

function extractCompany(subject: string, sender: ParsedSender): string | null {
  for (const re of COMPANY_SUBJECT_PATTERNS) {
    const match = subject.match(re);
    if (match?.[1]) {
      const company = cleanCompany(match[1]);
      if (company) return company;
    }
  }
  if (isAtsDomain(sender.domain) && sender.displayName) {
    return cleanCompany(sender.displayName);
  }
  return null;
}

/** Light role extraction: "…for the Software Engineer position/role". */
function extractRole(text: string): string | null {
  const match = text.match(/for the (.{2,60}?) (?:position|role)\b/i);
  if (!match?.[1]) return null;
  const role = match[1].trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return role || null;
}

// ---------------------------------------------------------------------------
// LinkedIn Easy Apply
// ---------------------------------------------------------------------------

/**
 * LinkedIn is mostly noise (alerts, "application viewed") — but its Easy Apply
 * receipts are real applications, and its "Your application to {role} at
 * {company}" mails wrap employer status updates whose CONTENT decides the
 * outcome. Returns:
 * - ClassifiedEmail: a definite Easy Apply receipt (applied_confirmation)
 * - null: an application status update — the LLM should read the body
 * - undefined: not a LinkedIn application signal; continue the normal flow
 */
function linkedInSignal(
  sender: ParsedSender,
  subject: string,
): ClassifiedEmail | null | undefined {
  if (!sender.domain || !domainMatches(sender.domain, "linkedin.com")) return undefined;

  // "Igal, your application was sent to Samsara"
  const sentTo = subject.match(/your application was sent to (.+?)\s*$/i);
  if (sentTo?.[1]) {
    const company = cleanCompany(sentTo[1]);
    if (company) {
      return { event: "applied_confirmation", company, role: null, confidence: "high", layer: "rules" };
    }
  }

  // "Thank you for applying for the Android Developer role at Initech"
  const applyingAt = subject.match(
    /thank you for applying for the (.+?) (?:role|position) at (.+?)\s*$/i,
  );
  if (applyingAt?.[2]) {
    const company = cleanCompany(applyingAt[2]);
    if (company) {
      return {
        event: "applied_confirmation",
        company,
        role: applyingAt[1]?.trim() || null,
        confidence: "high",
        layer: "rules",
      };
    }
  }

  // "Your application to Senior Backend Engineer at TestBox" — an employer
  // update relayed by LinkedIn; the body may be a rejection or fluff. Signal
  // the caller (null) to bypass the never-signals and let the phrase banks —
  // then the LLM — read the content.
  if (/your application to .+ at .+/i.test(subject) && !/viewed/i.test(subject)) {
    return null;
  }

  return undefined;
}

/** Company from a LinkedIn update subject: "your application to {role} at {company}". */
function linkedInUpdateCompany(subject: string): string | null {
  const match = subject.match(/your application to .+ at (.+?)\s*$/i);
  return match?.[1] ? cleanCompany(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Deterministic Layer-1 classification. Returns:
 * - a ClassifiedEmail when a rule fires (never-signal or phrase bank),
 * - null when the rules cannot decide and the LLM should look at it.
 */
export function classifyByRules(input: EmailInput): ClassifiedEmail | null {
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const sender = parseSender(input.from);
  const haystack = `${subject}\n${body}`;
  const ats = isAtsDomain(sender.domain);
  const atsConfidence: Confidence = ats ? "high" : "medium";
  // Gate for the generic phrase banks: an ATS sender or an application-
  // flavored subject. Without it, "book a time" / "offer letter" would mint
  // fake events on sales blasts and mortgage mail.
  const applicationSmell = ats || hasApplicationKeywords(subject);

  // 0. LinkedIn Easy Apply receipts / status updates — checked before the
  //    never-signals, which would otherwise eat them as job-board noise.
  //    A receipt classifies outright; a status update (linkedIn === null)
  //    bypasses the never-signals so the banks/LLM can read its content.
  const linkedIn = linkedInSignal(sender, subject);
  if (linkedIn) return linkedIn;
  const isLinkedInUpdate = linkedIn === null;

  // 1. NEVER-signals first — job-board noise short-circuits everything.
  if (!isLinkedInUpdate && isNeverSignal(sender, subject)) {
    return { event: "other", company: null, role: null, confidence: "high", layer: "rules" };
  }

  const company = isLinkedInUpdate
    ? linkedInUpdateCompany(subject)
    : extractCompany(subject, sender);
  const role = extractRole(haystack);
  const appliedMatched = APPLIED_PATTERNS.some((re) => re.test(haystack));

  // 2. REJECTION — explicit bank phrases always win. The "unfortunately +
  //    your application/candidacy" compound alone is ambiguous when the mail
  //    ALSO reads like a confirmation ("application received… unfortunately
  //    we only contact selected candidates"): for ATS senders abstain (null,
  //    LLM decides) instead of minting a high-confidence rejection; non-ATS
  //    mail falls through to the APPLIED bank below.
  if (REJECTION_PATTERNS.some((re) => re.test(haystack))) {
    return { event: "rejection", company, role, confidence: atsConfidence, layer: "rules" };
  }
  if (isCompoundRejection(haystack)) {
    if (!appliedMatched) {
      return { event: "rejection", company, role, confidence: atsConfidence, layer: "rules" };
    }
    if (ats) return null;
  }

  // 3. APPLIED confirmation
  if (appliedMatched) {
    return { event: "applied_confirmation", company, role, confidence: atsConfidence, layer: "rules" };
  }

  // 4. INTERVIEW — explicit invites fire from anyone; generic scheduling
  //    phrases only with application smell.
  if (
    INTERVIEW_EXPLICIT_PATTERNS.some((re) => re.test(haystack)) ||
    (applicationSmell && INTERVIEW_GENERIC_PATTERNS.some((re) => re.test(haystack)))
  ) {
    return { event: "interview_invite", company, role, confidence: atsConfidence, layer: "rules" };
  }

  // 5. OFFER — always medium from rules; offers deserve human confirmation.
  //    Gated on application smell ("offer letter" is mortgage-speak too).
  if (applicationSmell && OFFER_PATTERNS.some((re) => re.test(haystack))) {
    return { event: "offer", company, role, confidence: "medium", layer: "rules" };
  }

  // 6. Nothing matched.
  if (ats) return null; // ATS mail we can't parse → let the LLM decide.
  if (!APPLICATION_KEYWORD_PATTERN.test(subject)) {
    // Random non-ATS mail with no application smell — don't waste LLM calls.
    return { event: "other", company: null, role: null, confidence: "low", layer: "rules" };
  }
  return null; // Non-ATS but application-flavored subject → LLM decides.
}
