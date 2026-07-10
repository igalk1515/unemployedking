// scripts/classifier-check.ts — fixture checks for the rules classifier.
// Plain tsx script, no test framework:  npm run classifier:check
// Exits 1 with a field-level diff on any failure; prints a PASS summary otherwise.

import { classifyByRules } from "@/lib/classifier/rules";
import { htmlToText } from "@/lib/classifier/strip";
import type { ClassifiedEmail, EmailInput } from "@/lib/types";

const RECEIVED_AT = new Date("2026-07-01T10:00:00Z");

function email(from: string, subject: string, bodyText: string): EmailInput {
  return { from, subject, bodyText, receivedAt: RECEIVED_AT };
}

interface Fixture {
  name: string;
  input: EmailInput;
  expected: ClassifiedEmail | null;
}

const fixtures: Fixture[] = [
  {
    name: "greenhouse rejection (ATS, company from subject)",
    input: email(
      "Initech Recruiting <no-reply@us.greenhouse-mail.io>",
      "Your application to Initech",
      "Thank you for your interest in Initech. After careful consideration, we have decided to move forward with other candidates.",
    ),
    expected: { event: "rejection", company: "Initech", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "lever rejection (we regret to inform you)",
    input: email(
      "Hooli <no-reply@hire.lever.co>",
      "Update on your application at Hooli",
      "We regret to inform you that we will not be moving forward with your candidacy at this time.",
    ),
    expected: { event: "rejection", company: "Hooli", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "non-ATS rejection (unfortunately + your application => medium)",
    input: email(
      "Dunder Mifflin HR <careers@dundermifflin.com>",
      "Your application to Dunder Mifflin",
      "Unfortunately, we will not be able to progress your application at this time. We wish you the best of luck.",
    ),
    expected: { event: "rejection", company: "Dunder Mifflin", role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "hebrew rejection via comeet (ATS)",
    input: email(
      "Wix Careers <jobs@comeet.co>",
      "עדכון לגבי מועמדותך",
      "שלום, תודה על התעניינותך. לצערנו החלטנו להתקדם עם מועמדים אחרים. בהצלחה בהמשך הדרך.",
    ),
    expected: { event: "rejection", company: "Wix", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "greenhouse applied confirmation (company + role extraction)",
    input: email(
      "Pied Piper <no-reply@greenhouse-mail.io>",
      "Thank you for applying to Pied Piper!",
      "We have received your application for the Software Engineer position and will be in touch soon.",
    ),
    expected: {
      event: "applied_confirmation",
      company: "Pied Piper",
      role: "Software Engineer",
      confidence: "high",
      layer: "rules",
    },
  },
  {
    name: "workday applied confirmation (company from display name)",
    input: email(
      "Umbrella Corp <umbrella@myworkday.com>",
      "Application Confirmation",
      "Your application has been received. Reference: R-12345. You can check your status in the portal.",
    ),
    expected: { event: "applied_confirmation", company: "Umbrella Corp", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "non-ATS applied confirmation (medium, no company)",
    input: email(
      "Stark Industries Talent <talent@starkindustries.com>",
      "We received your application",
      "Thank you for applying. Our team will review your profile and get back to you.",
    ),
    expected: { event: "applied_confirmation", company: null, role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "ATS interview invite (schedule your interview)",
    input: email(
      "Aperture Science <no-reply@ashbyhq.com>",
      "Interview invitation",
      "We were impressed with your background and would like to schedule your interview. Please book a time using the link below.",
    ),
    expected: { event: "interview_invite", company: "Aperture Science", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "ATS 'would love to chat' counts as interview",
    input: email(
      "Globex <recruiting@smartrecruiters.com>",
      "Your application at Globex",
      "Thanks for your interest - we would love to chat about next steps!",
    ),
    expected: { event: "interview_invite", company: "Globex", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "recruiter cold outreach ('would love to chat' non-ATS => other/low)",
    input: email(
      "Jane Recruiter <jane@talentsourcing.io>",
      "Exciting opportunity at TechCorp",
      "Hi! I came across your profile and would love to chat about an exciting opening on my client's team.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "low", layer: "rules" },
  },
  {
    name: "offer is always medium from rules",
    input: email(
      "Wayne Enterprises <hr@teamtailor.com>",
      "Your offer from Wayne Enterprises",
      "Congratulations! We are pleased to offer you the position. Your offer letter is attached.",
    ),
    expected: { event: "offer", company: "Wayne Enterprises", role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "linkedin job alert digest (never-signal)",
    input: email(
      "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      "30+ new jobs for you in Tel Aviv",
      "Software Engineer at Initech and 29 more jobs match your preferences.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "'application viewed' notice (never-signal)",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Your application was viewed by Hooli",
      "Good news! Your application was viewed by the hiring team at Hooli.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "newsletter (non-ATS, no application keywords => other/low)",
    input: email(
      "TechCrunch <newsletter@techcrunch.com>",
      "This week in startups: AI everything",
      "Top stories of the week. Read in browser. Unsubscribe at any time.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "low", layer: "rules" },
  },
  {
    name: "ambiguous ATS email falls through to LLM (null)",
    input: email(
      "Massive Dynamic <no-reply@icims.com>",
      "A message from Massive Dynamic",
      "Please log in to your candidate portal to view an update.",
    ),
    expected: null,
  },
  {
    name: "non-ATS with application-flavored subject falls through to LLM (null)",
    input: email(
      "Acme HR <people@acme.com>",
      "Your application status",
      "There has been an update regarding your recent submission. Log in to view details.",
    ),
    expected: null,
  },
  {
    name: "glassdoor mail (never-signal domain)",
    input: email(
      "Glassdoor <noreply@glassdoor.com>",
      "New reviews for companies you follow",
      "See what employees are saying this week.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "indeed alert digest (never-signal)",
    input: email(
      "Indeed <alert@indeed.com>",
      "New jobs matching your search",
      "10 new Software Engineer jobs in your area.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "calendly-style sales blast ('book a time', non-ATS => other/low)",
    input: email(
      "Sam Growthly <sam@growthly.io>",
      "Quick sync this week?",
      "Hey! Loved what your team is shipping. Book a time with me this week and let's talk growth levers.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "low", layer: "rules" },
  },
  {
    name: "mortgage 'offer letter' (non-ATS => other/low)",
    input: email(
      "HomeLoans Plus <rates@homeloansplus.com>",
      "Your documents are ready to sign",
      "Congratulations! Your offer letter for the property at 12 Main St is ready. Your mortgage rate is locked for 30 days.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "low", layer: "rules" },
  },
  {
    name: "ATS confirmation with boilerplate 'unfortunately' abstains (null => LLM)",
    input: email(
      "Globex Recruiting <no-reply@myworkday.com>",
      "Your application to Globex",
      "Your application has been received. Unfortunately, due to volume, we will only contact you if your application is selected.",
    ),
    expected: null,
  },
  {
    name: "linkedin easy-apply receipt ('was sent to') => applied_confirmation",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Igal, your application was sent to Samsara",
      "Your application was sent to Samsara. The company will review it and respond via LinkedIn.",
    ),
    expected: { event: "applied_confirmation", company: "Samsara", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "linkedin 'thank you for applying for the X role at Y' => applied_confirmation",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Thank you for applying for the Android Developer role at Initech",
      "Your application has been submitted. Good luck!",
    ),
    expected: { event: "applied_confirmation", company: "Initech", role: "Android Developer", confidence: "high", layer: "rules" },
  },
  {
    name: "linkedin status update ('your application to X at Y') abstains (null => LLM)",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Your application to Senior Backend Engineer at TestBox",
      "Your update from TestBox: Your application is currently under review by the hiring team. We will keep you posted.",
    ),
    expected: null,
  },
  {
    name: "linkedin 'application was viewed' stays noise (other/high)",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Your application was viewed by Pave",
      "Good news! Someone at Pave viewed your application.",
    ),
    expected: { event: "other", company: null, role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "workable 'thanks for applying' variant => applied_confirmation",
    input: email(
      "Tamnoon.io <no-reply@candidates.workablemail.com>",
      "Thanks for applying to Tamnoon.io",
      "We received your application for Fullstack Engineer. Our team will review it shortly.",
    ),
    expected: { event: "applied_confirmation", company: "Tamnoon.io", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "workday rejection 'unfortunately, at this time we' beats applied phrase",
    input: email(
      "Adobe <do-not-reply@myworkday.com>",
      "Thank you for Applying to Adobe",
      "Thank you for your interest in Adobe. We appreciate the time you invested in the process and unfortunately, at this time we have decided to focus on candidates whose experience more closely matches our needs.",
    ),
    expected: { event: "rejection", company: "Adobe", role: null, confidence: "high", layer: "rules" },
  },
  {
    name: "linkedin update with explicit rejection body => rejection (company from 'at X')",
    input: email(
      "LinkedIn <jobs-noreply@linkedin.com>",
      "Your application to Senior Node.js Engineer at RYB Technologies",
      "Your update from RYB Technologies: We regret to inform you that we will not be moving forward with your application.",
    ),
    expected: { event: "rejection", company: "RYB Technologies", role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "human rejection 'decided not to move forward' (non-ATS, app-flavored subject)",
    input: email(
      "Zach Cline <zach@dryft.com>",
      "Update on your application",
      "Hi Igal, thanks for your patience. Unfortunately, after review, the team has decided not to move forward with your candidacy right now.",
    ),
    expected: { event: "rejection", company: null, role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "direct offer 'offer to join {Company}' (non-ATS => offer/medium)",
    input: email(
      "OpenLoop <victoria.syvret@openloophealth.com>",
      "Offer to join OpenLoop! - Signature requested by victoria.syvret@openloophealth.com",
      "We are excited to offer you a position at OpenLoop. Please review and sign your offer of employment.",
    ),
    expected: { event: "offer", company: "OpenLoop", role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "google calendar 'Interview with {Company} @ date' (non-ATS => interview/medium)",
    input: email(
      "Google Calendar <calendar-notification@google.com>",
      "Notification: Interview with OpenLoop Health @ Wed Mar 18, 2026 7:45pm - 8:30pm (GMT+2)",
      "This is a reminder for your upcoming event.",
    ),
    expected: { event: "interview_invite", company: "OpenLoop Health", role: null, confidence: "medium", layer: "rules" },
  },
  {
    name: "recruiter 'Interview Confirmation' (non-ATS => interview/medium, no company)",
    input: email(
      "Victoria Syvret <victoria.syvret@openloophealth.com>",
      "OpenLoop Health Interview Confirmation",
      "Hi Igal, Thanks for submitting your availability! Your interview is confirmed.",
    ),
    expected: { event: "interview_invite", company: null, role: null, confidence: "medium", layer: "rules" },
  },
];

// --- htmlToText sanity checks -------------------------------------------------

interface StripCheck {
  name: string;
  html: string;
  expected: string;
}

const stripChecks: StripCheck[] = [
  {
    name: "strips tags/scripts, decodes entities, collapses whitespace",
    html: "<div><p>Hello&nbsp;<b>World</b></p><script>var x = 1;</script>&amp; more &#8212; done</div>",
    expected: "Hello World & more — done",
  },
  {
    name: "br becomes a word boundary",
    html: "Line1<br>Line2",
    expected: "Line1 Line2",
  },
  {
    name: "entities decode after tag stripping (literal <script> survives)",
    html: "&lt;script&gt;",
    expected: "<script>",
  },
];

// --- runner --------------------------------------------------------------------

function show(value: ClassifiedEmail | string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

function diffFields(expected: ClassifiedEmail, actual: ClassifiedEmail): string[] {
  const keys: (keyof ClassifiedEmail)[] = ["event", "company", "role", "confidence", "layer"];
  return keys
    .filter((k) => expected[k] !== actual[k])
    .map((k) => `    field "${k}": expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(actual[k])}`);
}

let failures = 0;

for (const fixture of fixtures) {
  const actual = classifyByRules(fixture.input);
  const { expected } = fixture;

  const matches =
    expected === null
      ? actual === null
      : actual !== null && diffFields(expected, actual).length === 0;

  if (matches) {
    console.log(`  PASS  ${fixture.name}`);
    continue;
  }

  failures++;
  console.error(`  FAIL  ${fixture.name}`);
  console.error(`    expected: ${show(expected)}`);
  console.error(`    actual:   ${show(actual)}`);
  if (expected !== null && actual !== null) {
    for (const line of diffFields(expected, actual)) console.error(line);
  }
}

for (const check of stripChecks) {
  const actual = htmlToText(check.html);
  if (actual === check.expected) {
    console.log(`  PASS  htmlToText: ${check.name}`);
    continue;
  }
  failures++;
  console.error(`  FAIL  htmlToText: ${check.name}`);
  console.error(`    expected: ${show(check.expected)}`);
  console.error(`    actual:   ${show(actual)}`);
}

const total = fixtures.length + stripChecks.length;

if (failures > 0) {
  console.error(`\nFAIL: ${failures}/${total} checks failed.`);
  process.exit(1);
}

console.log(`\nPASS: all ${total} checks passed (${fixtures.length} rule fixtures, ${stripChecks.length} htmlToText checks).`);
