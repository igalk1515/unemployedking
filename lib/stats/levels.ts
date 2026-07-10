// Rejection levels — League-mastery-style progression. The more you are
// rejected, the more powerful you become.

const LEVEL_TITLES: { minLevel: number; title: string }[] = [
  { minLevel: 10, title: "Beyond Employment" },
  { minLevel: 7, title: "Rejection Royalty" },
  { minLevel: 5, title: "Veteran of the Void" },
  { minLevel: 3, title: "Seasoned Reject" },
  { minLevel: 1, title: "Fresh Meat" },
  { minLevel: 0, title: "The Optimist" },
];

/**
 * level = floor(sqrt(rejections)). Titles:
 * 0 "The Optimist", 1–2 "Fresh Meat", 3–4 "Seasoned Reject",
 * 5–6 "Veteran of the Void", 7–9 "Rejection Royalty", 10+ "Beyond Employment".
 */
export function rejectionLevel(rejections: number): { level: number; title: string } {
  const safeCount =
    Number.isFinite(rejections) && rejections > 0 ? Math.floor(rejections) : 0;
  const level = Math.floor(Math.sqrt(safeCount));
  const { title } = LEVEL_TITLES.find((t) => level >= t.minLevel) ?? {
    title: "The Optimist",
  };
  return { level, title };
}
