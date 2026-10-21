/**
 * Browser protections for every page. Kept out of next.config.ts so the policy can be unit tested.
 *
 * Scripts keep 'unsafe-inline'. Every Next.js page carries inline scripts holding its streamed React data, and
 * those change per page, so they cannot be allow-listed by hash (experimental SRI only covers external files).
 * A strict script-src needs per-request nonces, which forces every page to render on each request and defeats
 * the cached CMS pages. The remaining directives still limit what injected script could do: no plugins,
 * no <base> tricks, no framing, forms and network calls only to this site and the API, and the CMS's rich text
 * is sanitised by the Laravel API. Revisit with nonces for signed-in areas, which are rendered per request anyway.
 * Styles keep 'unsafe-inline' because React and the CMS theme set style attributes.
 */
export type SecurityHeaderOptions = { apiUrl: string; siteUrl: string; isDev: boolean };

const VIDEO_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];

export function contentSecurityPolicy({ apiUrl, siteUrl, isDev }: SecurityHeaderOptions): string {
  const apiOrigin = new URL(apiUrl).origin;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", apiOrigin],
    "font-src": ["'self'"],
    // The browser calls the Laravel API directly (tracking), and the dev server uses a websocket for hot reload.
    "connect-src": ["'self'", apiOrigin, ...(isDev ? ["ws:", "wss:"] : [])],
    "frame-src": VIDEO_HOSTS,
    "media-src": ["'self'", apiOrigin],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);

  // Only when the site itself is https: upgrading would break plain-http local development and testing.
  if (siteUrl.startsWith("https://") && !isDev) policy.push("upgrade-insecure-requests");

  return policy.join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (options.siteUrl.startsWith("https://") && !options.isDev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }

  return headers;
}
