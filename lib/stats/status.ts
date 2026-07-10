// Application status derivation — Data rule 2 in DESIGN.md.
// Status is NEVER stored; it is always computed from the append-only event log.

import type { ApplicationStatus, EventType } from "@/lib/types";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "applied",
  "rejected",
  "ghosted",
  "interview",
  "offer",
]);

/**
 * Derive an application's current status from its events.
 *
 * Rules (DESIGN.md §3, rule 2):
 * - Status is the type of the LAST event by `occurredAt`.
 * - Exception: a `ghosted` event is overridden by ANY event that occurs after
 *   it (or at the exact same instant — ghosted always loses ties). A later
 *   `rejected` after a `ghosted` therefore yields `rejected` (the Necromancer
 *   case 🧟).
 * - No events → `applied`.
 *
 * Input does not need to be sorted; unknown event types are ignored defensively.
 */
export function deriveStatus(
  events: { type: string; occurredAt: Date }[]
): ApplicationStatus {
  let status: EventType = "applied";
  let statusAtMs = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    if (!KNOWN_EVENT_TYPES.has(event.type)) continue;
    const type = event.type as EventType;
    const atMs = event.occurredAt.getTime();
    if (Number.isNaN(atMs)) continue;

    if (atMs > statusAtMs) {
      status = type;
      statusAtMs = atMs;
    } else if (atMs === statusAtMs && status === "ghosted" && type !== "ghosted") {
      // Tie at the same instant: the ghost is exorcised by any concrete event.
      status = type;
    }
  }

  return status;
}
