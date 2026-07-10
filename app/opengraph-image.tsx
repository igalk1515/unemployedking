// Open Graph / Twitter share card. Generated at build time via next/og.
// Next auto-injects og:image + twitter:image (via the metadata twitter card)
// from this file; the URL resolves against metadataBase in app/layout.tsx.

import { ImageResponse } from "next/og";

export const alt = "UnemployedKing — Get rejected. Get ranked.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d0d",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <svg width="240" height="200" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 72 L15 34 L40 56 L60 22 L80 56 L105 34 L105 72 Z" fill="#fab219" />
          <path d="M12 72 L108 72 L108 89 L12 89 Z" fill="#fab219" />
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 88,
            fontWeight: 800,
            marginTop: 20,
            letterSpacing: -2,
          }}
        >
          UnemployedKing
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: 600,
            color: "#fab219",
            marginTop: 6,
          }}
        >
          Get rejected. Get ranked.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#898781",
            marginTop: 30,
          }}
        >
          The job-hunt tracker that scores your rejections.
        </div>
      </div>
    ),
    { ...size },
  );
}
