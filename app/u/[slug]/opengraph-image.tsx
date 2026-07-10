// OG image for /u/[slug] — 1200×630, dark, crowned, three big stats.
// Self-contained: the crown is inline SVG (no emoji, so nothing is fetched
// from a CDN at render time) and the default bundled font is used.

import { ImageResponse } from "next/og";
import { getProfileStats, getUserBySlug } from "@/lib/stats/profile";
import type { HideableProfileField, ProfileStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export const alt =
  "UnemployedKing profile card: rejection level and career loss statistics";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Design tokens (mirrors app/globals.css — kept literal because ImageResponse
// renders outside the DOM and cannot read CSS custom properties).
const BG = "#0d0d0d";
const SURFACE = "#1a1a19";
const INK = "#ffffff";
const INK_2 = "#c3c2b7";
const INK_MUTED = "#898781";
const GOLD = "#fab219";
const RED = "#e66767";
const VIOLET = "#9085e9";

function Crown({ px }: { px: number }) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 17 L4.5 7 L9 11.5 L12 4.5 L15 11.5 L19.5 7 L21 17 Z"
        fill={GOLD}
      />
      <rect x="3" y="18.5" width="18" height="2.5" rx="1" fill={GOLD} />
    </svg>
  );
}

function truncate(name: string, max = 24): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * OG-ONLY name sanitizer: emoji / non-Latin glyphs make @vercel/og fetch
 * fallback fonts from a CDN at render time (and 500 offline), so keep only
 * basic printable ASCII plus Latin-1 letters here. Too little survives →
 * fall back to the slug. The profile PAGE still renders the full name.
 */
function ogSafeName(name: string, fallbackSlug: string): string {
  const latinOnly = name
    .replace(/[^\x20-\x7EÀ-ÖØ-öø-ÿ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return latinOnly.length >= 2 ? latinOnly : fallbackSlug;
}

interface BigStat {
  key: HideableProfileField;
  label: string;
  value: string;
  color: string;
}

/** The three headline stats, minus any the user has hidden from their profile. */
function statsRow(stats: ProfileStats, hidden: Set<HideableProfileField>): BigStat[] {
  const all: BigStat[] = [
    { key: "rejected", label: "REJECTED", value: String(stats.rejected), color: RED },
    { key: "ghosted", label: "GHOSTED", value: String(stats.ghosted), color: VIOLET },
    { key: "applied", label: "APPLIED", value: String(stats.applied), color: INK_2 },
  ];
  return all.filter((stat) => !hidden.has(stat.key));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let displayName: string | null = null;
  let stats: ProfileStats | null = null;
  let hidden = new Set<HideableProfileField>();
  try {
    const decoded = (() => {
      try {
        return decodeURIComponent(slug);
      } catch {
        return slug;
      }
    })();
    const user = await getUserBySlug(decoded);
    if (user) {
      displayName = ogSafeName(user.displayName, user.slug);
      stats = await getProfileStats(user.id);
      hidden = new Set(user.hiddenFields);
    }
  } catch (err) {
    // Never 500 a social crawler over a database hiccup — serve the brand card.
    console.error("[og-image] profile lookup failed:", err);
  }

  const known = displayName !== null && stats !== null;
  const bigStats = known ? statsRow(stats as ProfileStats, hidden) : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BG,
          padding: "56px 72px",
          borderTop: `10px solid ${GOLD}`,
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Crown px={56} />
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
            <span style={{ color: INK }}>Unemployed</span>
            <span style={{ color: GOLD }}>King</span>
          </div>
        </div>

        {/* Identity */}
        {known ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                color: INK,
                lineHeight: 1.05,
              }}
            >
              {truncate(displayName as string)}
            </div>
            <div style={{ display: "flex", fontSize: 38, gap: 14 }}>
              <span style={{ color: GOLD, fontWeight: 700 }}>
                Lv.{(stats as ProfileStats).rejectionLevel}
              </span>
              <span style={{ color: INK_2 }}>
                {(stats as ProfileStats).levelTitle}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                color: INK,
                lineHeight: 1.05,
              }}
            >
              Royal not found
            </div>
            <div style={{ display: "flex", fontSize: 36, color: INK_2 }}>
              Private, missing, or gainfully employed.
            </div>
          </div>
        )}

        {/* Big stats + tagline */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          {bigStats.length > 0 ? (
            <div style={{ display: "flex", gap: 28 }}>
              {bigStats.map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    backgroundColor: SURFACE,
                    borderRadius: 16,
                    padding: "20px 32px",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 72,
                      fontWeight: 700,
                      color: stat.color,
                      lineHeight: 1,
                    }}
                  >
                    {stat.value}
                  </span>
                  <span
                    style={{
                      marginTop: 10,
                      fontSize: 24,
                      letterSpacing: 3,
                      color: INK_MUTED,
                    }}
                  >
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 28, color: GOLD, fontWeight: 700 }}>
              Get rejected. Get ranked.
            </span>
            <span style={{ fontSize: 22, color: INK_MUTED }}>
              unemployedking
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
