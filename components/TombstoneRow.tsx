// 🪦 {Company} — {status} after {n} days. Status always emoji + word + color.

import type { ApplicationStatus } from "@/lib/types";
import { EVENT_THEME } from "./StatusChip";

interface TombstoneRowProps {
  company: string;
  status: ApplicationStatus;
  days: number;
}

export function TombstoneRow({ company, status, days }: TombstoneRowProps) {
  const theme = EVENT_THEME[status];
  return (
    <li className="flex items-baseline gap-2 border-b border-edge py-2.5 text-sm last:border-b-0">
      <span aria-hidden="true">🪦</span>
      <span className="truncate font-medium text-ink">{company}</span>
      <span aria-hidden="true" className="text-ink-muted">
        ·
      </span>
      <span className={`whitespace-nowrap ${theme.textClass}`}>
        <span aria-hidden="true">{theme.emoji}</span>{" "}
        {theme.label.toLowerCase()}
      </span>
      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-ink-muted">
        after {days} day{days === 1 ? "" : "s"}
      </span>
    </li>
  );
}
