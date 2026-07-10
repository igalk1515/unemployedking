// Manual-add form — plain HTML posting to a server action, works without JS.
// For rejections that arrived by phone, carrier pigeon, or pure vibes.

import { addManualApplication } from "@/app/dashboard/actions";

const inputClass =
  "w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink placeholder-ink-muted outline-none focus:border-gold/60";

export function ManualAddForm({ todayISO }: { todayISO: string }) {
  return (
    <form action={addManualApplication} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="manual-company"
          className="mb-1 block text-xs font-medium text-ink-2"
        >
          Company
        </label>
        <input
          id="manual-company"
          name="company"
          type="text"
          required
          maxLength={120}
          placeholder="Initech"
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="manual-role"
          className="mb-1 block text-xs font-medium text-ink-2"
        >
          Role <span className="text-ink-muted">(optional)</span>
        </label>
        <input
          id="manual-role"
          name="role"
          type="text"
          maxLength={120}
          placeholder="Senior Something Engineer"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="manual-date"
            className="mb-1 block text-xs font-medium text-ink-2"
          >
            Applied on
          </label>
          <input
            id="manual-date"
            name="appliedOn"
            type="date"
            required
            defaultValue={todayISO}
            max={todayISO}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="manual-status"
            className="mb-1 block text-xs font-medium text-ink-2"
          >
            Current status
          </label>
          <select
            id="manual-status"
            name="status"
            defaultValue="applied"
            className={inputClass}
          >
            <option value="applied">📨 Applied (still hopeful)</option>
            <option value="rejected">💀 Rejected (closure, at least)</option>
            <option value="ghosted">👻 Ghosted (the silent treatment)</option>
            <option value="interview">🎯 Interview (a human replied?!)</option>
            <option value="offer">🏆 Offer (why are you even here)</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        className="mt-1 self-start rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
      >
        Log the L
      </button>
    </form>
  );
}
