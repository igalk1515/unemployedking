// Browser-tab icon (favicon). Generated at build time via next/og so there is
// no binary asset to maintain. Gold crown on the brand dark background, drawn
// as inline SVG (no emoji font / CDN dependency).

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d0d",
        }}
      >
        <svg width="26" height="26" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 72 L15 34 L40 56 L60 22 L80 56 L105 34 L105 72 Z" fill="#fab219" />
          <path d="M12 72 L108 72 L108 89 L12 89 Z" fill="#fab219" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
