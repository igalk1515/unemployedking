// One earned badge — emoji, name, and the darkly funny description.

import type { Badge } from "@/lib/types";

export function BadgeChip({ badge }: { badge: Badge }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface p-4">
      <span aria-hidden="true" className="text-2xl leading-none">
        {badge.emoji}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{badge.name}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          {badge.description}
        </p>
      </div>
    </div>
  );
}
