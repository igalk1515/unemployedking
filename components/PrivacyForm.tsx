// Privacy & visibility — plain HTML posting to the updatePrivacy server action,
// works without JS. Two visibility toggles (public profile, leaderboard) plus a
// per-field "hide this on my public profile" grid. Checked in the hide grid ==
// hidden. The server re-validates the field allow-list; this is convenience.

import { updatePrivacy } from "@/app/dashboard/actions";
import {
  HIDEABLE_PROFILE_FIELDS,
  HIDEABLE_PROFILE_FIELD_META,
  type HideableProfileField,
  type ProfileFieldGroup,
} from "@/lib/types";

const GROUPS: ProfileFieldGroup[] = ["Career totals", "Time records", "Sections"];
const checkboxStyle = { accentColor: "#fab219" } as const;

function ToggleRow({
  name,
  defaultChecked,
  title,
  hint,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-edge bg-bg p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        style={checkboxStyle}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

export function PrivacyForm({
  publicProfile,
  leaderboardOptIn,
  hiddenFields,
}: {
  publicProfile: boolean;
  leaderboardOptIn: boolean;
  hiddenFields: HideableProfileField[];
}) {
  const hidden = new Set(hiddenFields);

  return (
    <form action={updatePrivacy} className="mt-3 flex flex-col gap-4">
      {/* Visibility toggles */}
      <div className="flex flex-col gap-2">
        <ToggleRow
          name="publicProfile"
          defaultChecked={publicProfile}
          title="🌍 Public profile"
          hint="On, anyone with your link can see your profile. Off, it returns a 404 to everyone but you."
        />
        <ToggleRow
          name="leaderboardOptIn"
          defaultChecked={leaderboardOptIn}
          title="🏆 Show me on the leaderboard"
          hint="Off, you still get ranked in private. You just won’t appear on the public boards."
        />
      </div>

      {/* Per-field hiding */}
      <fieldset className="rounded-lg border border-edge bg-bg p-3">
        <legend className="px-1 text-xs font-medium text-ink-2">
          Hide fields on your public profile
        </legend>
        <p className="mb-2 text-xs text-ink-muted">
          Checked means hidden. Everything is shown by default. This affects your
          profile page and share card, not the leaderboard.
        </p>
        <div className="flex flex-col gap-3">
          {GROUPS.map((group) => {
            const fields = HIDEABLE_PROFILE_FIELDS.filter(
              (field) => HIDEABLE_PROFILE_FIELD_META[field].group === group,
            );
            return (
              <div key={group}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  {group}
                </p>
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {fields.map((field) => {
                    const meta = HIDEABLE_PROFILE_FIELD_META[field];
                    return (
                      <label
                        key={field}
                        className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
                      >
                        <input
                          type="checkbox"
                          name={`hide:${field}`}
                          defaultChecked={hidden.has(field)}
                          style={checkboxStyle}
                          className="h-4 w-4"
                        />
                        <span aria-hidden="true">{meta.emoji}</span>
                        {meta.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        className="self-start rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-gold/85"
      >
        Save privacy settings
      </button>
    </form>
  );
}
