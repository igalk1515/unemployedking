"use client";

// Auto-sync cadence picker. A <select> (off / daily / weekly / custom) posting
// to the updateAutoSync server action; the "Custom…" option reveals a day input.
// The server re-validates the bounds — this is only the convenience layer.

import { useState } from "react";
import { updateAutoSync } from "@/app/dashboard/actions";

type Preset = "off" | "1" | "7" | "custom";

const DEFAULT_CUSTOM = "14";

function presetFor(intervalDays: number | null): { preset: Preset; custom: string } {
  if (intervalDays == null) return { preset: "off", custom: DEFAULT_CUSTOM };
  if (intervalDays === 1) return { preset: "1", custom: DEFAULT_CUSTOM };
  if (intervalDays === 7) return { preset: "7", custom: DEFAULT_CUSTOM };
  return { preset: "custom", custom: String(intervalDays) };
}

export function AutoSyncForm({
  intervalDays,
  maxIntervalDays,
}: {
  intervalDays: number | null;
  maxIntervalDays: number;
}) {
  const initial = presetFor(intervalDays);
  const [preset, setPreset] = useState<Preset>(initial.preset);

  return (
    <form
      action={updateAutoSync}
      className="mt-4 flex flex-wrap items-center gap-2 border-t border-edge pt-3"
    >
      <label htmlFor="autoSyncPreset" className="text-xs text-ink-muted">
        🔁 Auto-sync
      </label>
      <select
        id="autoSyncPreset"
        name="preset"
        value={preset}
        onChange={(e) => setPreset(e.target.value as Preset)}
        className="rounded-lg border border-edge bg-bg px-2 py-1.5 text-xs text-ink"
      >
        <option value="off">Manual only</option>
        <option value="1">Every day</option>
        <option value="7">Every 7 days</option>
        <option value="custom">Custom…</option>
      </select>

      {preset === "custom" ? (
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            name="customDays"
            min={1}
            max={maxIntervalDays}
            required
            defaultValue={initial.custom}
            aria-label="Custom auto-sync interval in days"
            className="w-16 rounded-lg border border-edge bg-bg px-2 py-1.5 text-xs tabular-nums text-ink"
          />
          <span className="text-xs text-ink-muted">days</span>
        </span>
      ) : null}

      <button
        type="submit"
        className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
      >
        Save
      </button>

      <p className="w-full text-xs text-ink-muted">
        {preset === "off"
          ? "Off. Your rejections pile up until you hit “Sync now.”"
          : "A scheduled job re-checks your inbox on this cadence. Set it and forget your job hunt. We won’t."}
      </p>
    </form>
  );
}
