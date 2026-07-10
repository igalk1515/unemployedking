"use client";

// Copies an absolute URL (origin + path) to the clipboard. Client-only so the
// server never needs to guess its own public origin.

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function CopyUrlButton({
  path,
  label = "Copy link",
}: {
  path: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-gold/50 hover:text-ink"
    >
      {state === "copied"
        ? "Copied! Go brag."
        : state === "failed"
          ? "Copy failed, fitting"
          : label}
    </button>
  );
}
