import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

const prod = { apiUrl: "https://api.example.test/some/path", siteUrl: "https://www.example.test", isDev: false };
const parse = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

describe("contentSecurityPolicy", () => {
  it("allows only this site and the API origin for network calls, images and media", () => {
    const csp = parse(contentSecurityPolicy(prod));

    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'", "https://api.example.test"]);
    expect(csp["img-src"]).toContain("https://api.example.test");
    expect(csp["media-src"]).toContain("https://api.example.test");
    expect(JSON.stringify(csp)).not.toContain("/some/path");
  });

  it("blocks plugins, base-tag tricks, framing and off-site form posts", () => {
    const csp = parse(contentSecurityPolicy(prod));

    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("limits embeds to the privacy-friendly video hosts the CMS supports", () => {
    expect(parse(contentSecurityPolicy(prod))["frame-src"]).toEqual(["https://www.youtube-nocookie.com", "https://player.vimeo.com"]);
  });

  it("never allows eval in production, nor wildcards or remote scripts", () => {
    const policy = contentSecurityPolicy(prod);
    const scripts = parse(policy)["script-src"];

    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.filter((v) => v.includes("*") || v.startsWith("http"))).toEqual([]);
    expect(policy).not.toMatch(/\*/);
  });

  it("allows eval and websockets only in development", () => {
    const dev = parse(contentSecurityPolicy({ ...prod, siteUrl: "http://localhost:3000", isDev: true }));

    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
    expect(parse(contentSecurityPolicy(prod))["connect-src"]).not.toContain("ws:");
  });

  it("upgrades insecure requests only on an https production site", () => {
    expect(contentSecurityPolicy(prod)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ ...prod, siteUrl: "http://localhost:3000" })).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ ...prod, isDev: true })).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  const byKey = (options: Parameters<typeof securityHeaders>[0]) => Object.fromEntries(securityHeaders(options).map((h) => [h.key, h.value]));

  it("sets the standard protections", () => {
    const headers = byKey(prod);

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Content-Security-Policy"]).toBeTruthy();
  });

  it("sends HSTS only for an https production site", () => {
    expect(byKey(prod)["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(byKey({ ...prod, siteUrl: "http://localhost:3000" })["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey({ ...prod, isDev: true })["Strict-Transport-Security"]).toBeUndefined();
  });
});
