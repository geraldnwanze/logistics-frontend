/**
 * What the service worker may cache. Kept separate from sw.js so the rules can be unit tested.
 * The rule of thumb: only public, same-origin, successful GET responses; never anything personal.
 */
(function (root) {
  var VERSION = "v1";
  var PAGES_CACHE = "pages-" + VERSION;
  var STATIC_CACHE = "static-" + VERSION;
  var OFFLINE_URL = "/offline.html";
  var MAX_PAGES = 30;
  var MAX_STATIC = 120;

  // Paths that are private, per-user, or must always be live.
  var NEVER_CACHE = [/^\/api\//, /^\/preview(\/|$)/, /^\/account(\/|$)/, /^\/admin(\/|$)/, /^\/(login|register|forgot-password|reset-password|email-verified|book|shipments|sandbox-pay|support|claims)(\/|$)/, /^\/quote\/./, /^\/sandbox-pay(\/|$)/, /^\/_next\/data\//, /^\/sw(-policy)?\.js$/];
  var STATIC_PATHS = [/^\/_next\/static\//, /^\/icons\//];

  /**
   * @param {{url: string, method: string, mode?: string}} request
   * @param {string} origin the service worker's own origin
   * @returns {"static" | "page" | "bypass"}
   */
  function classify(request, origin) {
    if (request.method !== "GET") return "bypass";

    var url = new URL(request.url);
    if (url.origin !== origin) return "bypass"; // the Laravel API and third parties are never cached here
    if (NEVER_CACHE.some(function (pattern) { return pattern.test(url.pathname); })) return "bypass";
    if (STATIC_PATHS.some(function (pattern) { return pattern.test(url.pathname); })) return "static";
    if (request.mode === "navigate") return "page";

    return "bypass";
  }

  /**
   * Next.js marks every page "private, no-store" (even fully public CMS pages), so for pages that header cannot be
   * the test: private areas are excluded by path in classify() instead, and Set-Cookie still disqualifies a response.
   * Build assets and icons are held to the stricter rule and must not be marked private or no-store.
   *
   * @param {{status: number, type: string, headers: {get(name: string): string | null}}} response
   * @param {"static" | "page"} kind
   */
  function isCacheable(response, kind) {
    if (response.status !== 200 || response.type !== "basic") return false;
    if (response.headers.get("Set-Cookie")) return false;

    if (kind === "static") {
      var cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
      if (/\b(no-store|private)\b/.test(cacheControl)) return false;
    }

    return true;
  }

  var api = { VERSION: VERSION, PAGES_CACHE: PAGES_CACHE, STATIC_CACHE: STATIC_CACHE, OFFLINE_URL: OFFLINE_URL, MAX_PAGES: MAX_PAGES, MAX_STATIC: MAX_STATIC, classify: classify, isCacheable: isCacheable };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SwPolicy = api;
})(typeof self !== "undefined" ? self : this);
