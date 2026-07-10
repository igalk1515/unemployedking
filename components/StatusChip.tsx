// Semantic event colors — ALWAYS paired with emoji + word, never color alone
// (DESIGN §4.6). EVENT_THEME is the single source of truth for that pairing.

import type { ApplicationStatus } from "@/lib/types";

interface EventTheme {
  emoji: string;
  label: string;
  /** Text color class for inline mentions of the status. */
  textClass: string;
  /** Full chip styling (border + tinted bg + text). */
  chipClass: string;
}

export const EVENT_THEME: Record<ApplicationStatus, EventTheme> = {
  applied: {
    emoji: "📨",
    label: "Applied",
    textClass: "text-ink-2",
    chipClass: "border-ink-2/25 bg-ink-2/10 text-ink-2",
  },
  rejected: {
    emoji: "💀",
    label: "Rejected",
    textClass: "text-red",
    chipClass: "border-red/30 bg-red/10 text-red",
  },
  ghosted: {
    emoji: "👻",
    label: "Ghosted",
    textClass: "text-violet",
    chipClass: "border-violet/30 bg-violet/10 text-violet",
  },
  interview: {
    emoji: "🎯",
    label: "Interview",
    textClass: "text-blue",
    chipClass: "border-blue/30 bg-blue/10 text-blue",
  },
  offer: {
    emoji: "🏆",
    label: "Offer",
    textClass: "text-good",
    chipClass: "border-good/30 bg-good/10 text-good",
  },
};

export function StatusChip({ status }: { status: ApplicationStatus }) {
  const theme = EVENT_THEME[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${theme.chipClass}`}
    >
      <span aria-hidden="true">{theme.emoji}</span>
      {theme.label}
    </span>
  );
}
