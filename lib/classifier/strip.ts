// lib/classifier/strip.ts — HTML → plain text for email bodies.
// No dependencies, no network. Used by the Gmail module when a message only
// has a text/html part, and by anything that needs to normalize email HTML
// before running the rules/LLM classifier over it.

/** Common named HTML entities seen in transactional email. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  middot: "·",
  shy: "", // soft hyphen — invisible, drop it
  zwnj: "",
  zwj: "",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      const named = NAMED_ENTITIES[entity.toLowerCase()];
      return named !== undefined ? named : match;
    },
  );
}

/**
 * Strip tags, decode entities, collapse whitespace.
 *
 * - `<script>`, `<style>`, `<head>` and HTML comments are removed with their
 *   contents (they are never human-visible text).
 * - Block-level closers and `<br>` become whitespace so words from adjacent
 *   elements don't fuse together.
 * - Entities are decoded AFTER tag stripping so `&lt;b&gt;` in text survives
 *   as the literal `<b>` instead of being eaten as a tag.
 * - All whitespace runs collapse to a single space; result is trimmed.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html;

  // Drop invisible containers with their contents.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|head|title|template)\b[\s\S]*?<\/\1\s*>/gi, " ");

  // Block boundaries → whitespace so "Hello</p><p>World" ≠ "HelloWorld".
  text = text.replace(
    /<\/?(?:br|p|div|tr|td|th|li|ul|ol|table|h[1-6]|blockquote|section|article|header|footer|hr)\b[^>]*\/?>/gi,
    " ",
  );

  // Strip every remaining tag.
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities now that tags are gone.
  text = decodeEntities(text);

  // Collapse all whitespace (incl. NBSP already decoded to space) and trim.
  text = text.replace(/\s+/g, " ").trim();

  return text;
}
