import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:8000");

const nextConfig: NextConfig = {
  // Lets the e2e suite build into its own directory without clobbering `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    remotePatterns: [
      {
        protocol: apiUrl.protocol.replace(":", "") as "http" | "https",
        hostname: apiUrl.hostname,
        port: apiUrl.port,
        pathname: "/storage/**",
      },
    ],
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // The worker and its rules must never be served stale, or a bad version could not be replaced.
    const noCache = [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }];

    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          apiUrl: apiUrl.href,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
          isDev: process.env.NODE_ENV === "development",
        }),
      },
      { source: "/sw.js", headers: [...noCache, { key: "Content-Type", value: "application/javascript; charset=utf-8" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/sw-policy.js", headers: noCache },
      { source: "/offline.html", headers: noCache },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
