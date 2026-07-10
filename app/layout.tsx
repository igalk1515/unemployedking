// Root layout — dark-only chrome: sticky nav, page slot, small-print footer.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

function siteUrl(): URL {
  for (const raw of [process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    if (!raw) continue;
    try {
      return new URL(raw);
    } catch {
      // Misconfigured env var; fall through to the dev default.
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "UnemployedKing 👑 · Get rejected. Get ranked.",
    template: "%s · UnemployedKing 👑",
  },
  description:
    "The darkly funny job-hunt tracker. Connect Gmail (read-only), count your rejections, earn badges, and fight for the weekly crown.",
  applicationName: "UnemployedKing",
  keywords: [
    "job search tracker",
    "rejection tracker",
    "job application tracker",
    "Gmail job tracker",
    "ATS emails",
    "job hunt leaderboard",
    "unemployed",
  ],
  authors: [{ name: "UnemployedKing" }],
  // og:image and twitter:image are injected automatically from
  // app/opengraph-image.tsx; the tab icon comes from app/icon.tsx.
  openGraph: {
    title: "UnemployedKing 👑 · Get rejected. Get ranked.",
    description:
      "Count your rejections, earn badges, and fight for the weekly crown. The job-hunt tracker for people who stopped pretending.",
    siteName: "UnemployedKing",
    type: "website",
    locale: "en_US",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "UnemployedKing 👑 · Get rejected. Get ranked.",
    description:
      "Count your rejections, earn badges, and fight for the weekly crown.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-ink antialiased">
        <Nav />
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-edge">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              <span aria-hidden="true">👑</span> UnemployedKing: every
              “unfortunately” is XP.
            </p>
            <p>
              Read-only Gmail. Bodies counted, never stored. The shame stays
              aggregate.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
