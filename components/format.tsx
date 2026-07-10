// Tiny display formatters shared across the UI. All date math/labels are UTC
// (DESIGN §2) so server-rendered strings are stable regardless of host TZ.

/** "42 min", "3.5 h", "12 days" — for applied→rejected gaps. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "N/A";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}

/** "Jul 6, 2026" in UTC. */
export function formatDateUTC(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Jul 6" in UTC — for week labels. */
export function formatDayUTC(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** "Jul 2026" in UTC — for "losing since" labels. */
export function monthYearUTC(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
}

/** Coarse relative time: "just now", "5m ago", "3h ago", "12d ago". */
export function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** YYYY-MM-DD for today's UTC date — feeds <input type="date">. */
export function todayISOUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
