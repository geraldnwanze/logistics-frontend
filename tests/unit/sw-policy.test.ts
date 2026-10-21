import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const policy = createRequire(import.meta.url)("../../public/sw-policy.js") as {
  classify: (request: { url: string; method: string; mode?: string }, origin: string) => "static" | "page" | "bypass";
  isCacheable: (response: { status: number; type: string; headers: Headers }, kind: "static" | "page") => boolean;
};

const ORIGIN = "https://www.example.test";
const request = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => ({
  url: `${init.origin ?? ORIGIN}${path}`,
  method: init.method ?? "GET",
  mode: init.mode,
});
const response = (headers: Record<string, string> = {}, init: { status?: number; type?: string } = {}) => ({ status: init.status ?? 200, type: init.type ?? "basic", headers: new Headers(headers) });

describe("classify", () => {
  it("caches build assets and icons, and public page navigations", () => {
    expect(policy.classify(request("/_next/static/chunks/app.js"), ORIGIN)).toBe("static");
    expect(policy.classify(request("/icons/icon-192.png"), ORIGIN)).toBe("static");
    expect(policy.classify(request("/about", { mode: "navigate" }), ORIGIN)).toBe("page");
  });

  it("never touches writes, cross-origin calls (the API) or private areas", () => {
    expect(policy.classify(request("/about", { method: "POST", mode: "navigate" }), ORIGIN)).toBe("bypass");
    expect(policy.classify(request("/api/v1/shipments", { origin: "https://api.example.test" }), ORIGIN)).toBe("bypass");
    expect(policy.classify(request("/api/revalidate"), ORIGIN)).toBe("bypass");

    for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/email-verified", "/book/abc?option=x", "/shipments/01ABC", "/support", "/support/tickets/T1", "/claims/C1", "/sandbox-pay?reference=r", "/quote/01ABC", "/preview", "/account/orders", "/admin", "/sandbox-pay/abc", "/_next/data/x/page.json", "/sw.js", "/sw-policy.js"]) {
      expect(policy.classify(request(path, { mode: "navigate" }), ORIGIN), path).toBe("bypass");
    }
  });

  it("leaves other subresource requests (images, fetch calls) to the browser", () => {
    expect(policy.classify(request("/photo.jpg"), ORIGIN)).toBe("bypass");
    expect(policy.classify(request("/anything.json", { mode: "cors" }), ORIGIN)).toBe("bypass");
  });
});

describe("isCacheable", () => {
  it("accepts ordinary successful same-origin responses", () => {
    expect(policy.isCacheable(response(), "static")).toBe(true);
    expect(policy.isCacheable(response({ "Cache-Control": "public, max-age=31536000, immutable" }), "static")).toBe(true);
    expect(policy.isCacheable(response(), "page")).toBe(true);
  });

  it("accepts pages even though Next.js marks them private, because private areas are excluded by path", () => {
    const next = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };

    expect(policy.isCacheable(response(next), "page")).toBe(true);
    expect(policy.classify(request("/account", { mode: "navigate" }), ORIGIN)).toBe("bypass");
  });

  it("holds build assets to the stricter rule", () => {
    expect(policy.isCacheable(response({ "Cache-Control": "private, no-store" }), "static")).toBe(false);
    expect(policy.isCacheable(response({ "Cache-Control": "PRIVATE" }), "static")).toBe(false);
  });

  it.each(["static", "page"] as const)("rejects errors, partial, opaque and cookie-setting responses (%s)", (kind) => {
    expect(policy.isCacheable(response({}, { status: 404 }), kind)).toBe(false);
    expect(policy.isCacheable(response({}, { status: 206 }), kind)).toBe(false);
    expect(policy.isCacheable(response({}, { type: "opaque" }), kind)).toBe(false);
    expect(policy.isCacheable(response({ "Set-Cookie": "session=abc" }), kind)).toBe(false);
  });
});
