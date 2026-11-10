import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Security headers for every response (docs/ARCHITECTURE.md §4.3). Scripts
// only from Sevak itself: no inline scripts, so an injected <script> can't
// run. (Styles still allow inline style attributes, which the pages use.)
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  // A self-contained server for the container image (see Dockerfile).
  output: "standalone",
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@sevak/core", "@sevak/db"],
  serverExternalPackages: ["@electric-sql/pglite"],
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The camera only for taking a profile photo here; nothing else.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          // Other sites' windows can't reach into Sevak's (links out open
          // with noopener; Google sign-in is a redirect, not a popup), and
          // other sites can't load Sevak's responses, files included.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // Uploaded files: always downloads, and if a browser ever shows one
      // instead, nothing in it runs. (Later rules win over the one above.)
      {
        source: "/api/v1/files/:id",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }],
      },
    ];
  },
};

export default config;
