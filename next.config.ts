import type { NextConfig } from "next";

// Security headers (CASA Tier 2 / OWASP ZAP baseline).
//
// Set here rather than in the proxy so they also cover static assets
// (/_next/static/*, /icon, OG images) — ZAP flags a missing nosniff header on
// those too. The Content-Security-Policy is NOT here: it carries a per-request
// nonce and is set in proxy.ts.
//
// nginx on the box is a plain reverse proxy that adds no headers of its own,
// so whatever the app emits is what the browser gets.
const securityHeaders = [
  // Don't let a MIME sniff turn a .js chunk into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt (X-Frame-Options) and suspenders (CSP frame-ancestors, in proxy.ts).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We ask for no device APIs. Say so out loud.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Cross-origin isolation: every resource this app loads is same-origin.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // HTTPS only. Ignored by browsers over plain http (localhost); enforced in
  // production behind nginx + Let's Encrypt.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Stop advertising the framework and its version to every scanner on earth.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
