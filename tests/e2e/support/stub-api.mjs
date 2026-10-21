// A stand-in for the Laravel public CMS API (GET /api/v1/public/*) so the frontend can be
// tested end to end without PHP, PostgreSQL or Redis. Payload shapes mirror the real API
// (see App\Http\Controllers\Api\V1\Public\ContentController). It is NOT the source of truth
// for business behaviour; control endpoints under /__ let tests change the "CMS" state.
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_API_PORT ?? 4010);

const block = (id, type, props, extra = {}) => ({
  id, type, props,
  visibility: { mobile: true, tablet: true, desktop: true },
  style: { background: "none", align: null },
  anchor: null,
  ...extra,
});

const initialState = () => ({
  homeHeadline: "Ship anywhere. Track everything.",
  maintenance: false,
  announcement: { enabled: false, text: null, link: null, tone: "info" },
  fail: false,
  // Sign-in stub: ada@example.test is a customer; staff@example.test already has two-factor (code 123456, recovery aaaaa-bbbbb).
  shop: { quotes: {}, shipments: {}, idempotency: {}, created: 0, payments: {}, sandboxOff: false, paymentDown: false, confirmDelay: 0, tickets: {}, claims: {} },
  auth: { ada2fa: false, setupStarted: false, attempts: 0, registered: {}, password: "Str0ng-Passphrase-1", profile: { phone: null, locale: "en", timezone: "UTC", preferred_currency: "USD", deletion_requested: false } },
});

let state = initialState();

const settings = () => ({
  general: { business_name: "Stub Logistics", tagline: "Shipping across borders.", logo: null, logo_alt: null, favicon: null, default_locale: "en", enabled_languages: ["en", "fr"] },
  branding: { primary_color: "#0B3C6F", secondary_color: "#14213D", accent_color: "#F5A524", heading_font: "inter", body_font: "inter" },
  contact: { email: "hello@stub.test", phone: "+1 555 0100", support_email: null, support_phone: null, support_hours: "Mon–Fri 9–17", addresses: [] },
  social: { facebook: null, x: null, instagram: null, linkedin: "https://linkedin.com/company/stub", youtube: null },
  layout: { header_style: "standard", footer_columns: 4 },
  announcement: state.announcement,
  site: { maintenance_mode: state.maintenance, maintenance_message: "Back soon — scheduled maintenance.", cookie_banner_enabled: true, cookie_banner_text: null },
  seo: { default_title: null, default_description: "Stub description", default_og_image: null },
});

const menus = {
  header: { key: "header", locale: "en", items: [
    { id: 1, label: "Track Shipment", type: "page", href: "/track", audience: "everyone", children: [] },
    { id: 2, label: "Services", type: "group", audience: "everyone", children: [
      { id: 3, label: "International Shipping", type: "page", href: "/international-shipping", audience: "everyone", children: [] },
    ] },
    { id: 4, label: "About", type: "page", href: "/about-us", audience: "everyone", children: [] },
    { id: 5, label: "Members only", type: "external", href: "/members", audience: "authenticated", children: [] },
  ] },
  footer: { key: "footer", locale: "en", items: [
    { id: 6, label: "Company", type: "group", audience: "everyone", children: [
      { id: 7, label: "About Us", type: "page", href: "/about-us", audience: "everyone", children: [] },
    ] },
  ] },
};

const pages = () => ({
  home: {
    id: "01HOME", slug: "home", title: "Home", meta: { title: "Stub Home", description: "Home description" }, published_at: null,
    blocks: [
      block("b-hero", "hero", {
        headline: state.homeHeadline, subheadline: "Parcels, documents and freight.", show_tracking: true,
        primary_cta: { label: "Get a quote", href: "/quote" },
      }),
      block("b-features", "feature_grid", { heading: "Why ship with us", columns: 3, items: [
        { icon: "eye", title: "Transparent pricing", text: "See every charge." },
        { icon: "map-pin", title: "Live tracking", text: "Follow each step." },
      ] }),
      block("b-desktop-only", "rich_text", { html: "<p>Visible on desktop only</p>" }, { visibility: { mobile: false, tablet: false, desktop: true } }),
      block("b-mobile-only", "rich_text", { html: "<p>Visible on mobile only</p>" }, { visibility: { mobile: true, tablet: false, desktop: false } }),
      block("b-quote", "quote_widget", { heading: "Quote" }),
    ],
  },
  "about-us": {
    id: "01ABOUT", slug: "about-us", title: "About Us", meta: { title: "About Us", description: "About description" }, published_at: null,
    blocks: [
      block("a-text", "rich_text", { html: "<h2>About us</h2><p>We move things.</p>" }),
      block("a-faq", "faq", { heading: "FAQ", items: [{ question: "How do I track?", answer_html: "<p>Use the tracking box.</p>" }] }),
    ],
  },
  track: {
    id: "01TRACK", slug: "track", title: "Track Shipment", meta: {}, published_at: null,
    blocks: [block("t-widget", "tracking_widget", { heading: "Track your shipment", help_text: "Find it in your confirmation email." })],
  },
  "international-shipping": {
    id: "01INTL", slug: "international-shipping", title: "International Shipping", meta: {}, published_at: null,
    blocks: [block("i-hero", "hero", { headline: "International shipping" })],
  },
  "private-notes": {
    id: "01NOINDEX", slug: "private-notes", title: "Hidden from search", meta: { noindex: true }, published_at: null,
    blocks: [block("n-text", "rich_text", { html: "<p>Not for search engines</p>" })],
  },
});

const draft = {
  id: "01HOME", slug: "home", title: "Unreleased draft", meta: {}, published_at: null,
  blocks: [block("d-text", "rich_text", { html: "<p>Draft only content</p>" })],
};

let currentOrigin = "*";

function send(response, status, body, extra = {}) {
  // The browser calls this API directly (tracking, sign-in), so it needs the CORS headers Laravel sends in production:
  // an explicit origin and credentials, never a wildcard.
  const credentials = currentOrigin !== "*" ? { "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {};
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": currentOrigin, "Access-Control-Expose-Headers": "Retry-After, Idempotent-Replayed", ...credentials, ...extra });
  response.end(body === null ? undefined : JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();

  return raw ? JSON.parse(raw) : {};
}

const event = (id, code, label, extra = {}) => ({
  id, status: { code, label }, description: null, occurred_at: "2026-10-12T08:30:00+00:00", local_time: "2026-10-12T09:30:00+01:00", timezone: "Africa/Lagos",
  location: { city: "Lagos", country: "NG", facility: null }, source: "simulated", reason: null, delivered_to: null, ...extra,
});

const trackingFixture = (number, over = {}) => ({
  tracking_number: number, status: { code: "in_transit", label: "In transit" }, service: "International Economy", is_demo: true,
  origin: { city: "Lagos", country: "NG" }, destination: { city: "Berlin", country: "DE" },
  estimated_delivery: { earliest: "2026-10-20", latest: "2026-10-24" }, delivered_at: null, last_updated_at: "2026-10-13T10:00:00+00:00",
  timeline: [
    event("e1", "booking_confirmed", "Booking confirmed"),
    event("e2", "picked_up", "Picked up", { description: "Collected from sender", occurred_at: "2026-10-13T08:00:00+00:00" }),
    event("e3", "in_transit", "In transit", { occurred_at: "2026-10-14T08:00:00+00:00", location: { city: "Frankfurt", country: "DE", facility: "FRA hub" }, timezone: "Europe/Berlin" }),
  ],
  data_sources: ["simulated"], notice: "Some updates on this shipment are simulated demonstration data, not real carrier scans.", ...over,
});

const currentPassword = () => state.auth.password;
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `code${i}-abcde`);

const cookies = (request) => Object.fromEntries((request.headers.cookie ?? "").split("; ").filter(Boolean).map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]));
const setCookie = (name, value, { httpOnly = true, maxAge } = {}) => `${name}=${value}; Path=/; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}${maxAge === 0 ? "; Max-Age=0" : ""}`;
const err = (response, status, code, message, errors) => send(response, status, { error: { code, message, ...(errors ? { errors } : {}) } });

const AGENT_PERMISSIONS = ["tickets.manage", "claims.manage"];
const FINANCE_PERMISSIONS = ["claims.approve", "refunds.approve"];
const CLAIM_READERS = ["claims.manage", "claims.approve", "refunds.approve"];
const COLLEAGUES = [{ id: "01HAGENT000000000000000000", name: "Alex Agent" }, { id: "01HBEA00000000000000000000", name: "Bea Booker" }, { id: "01HCAL00000000000000000000", name: "Cal Carter" }];
const OPS_PERMISSIONS = ["shipments.view", "shipments.update", "shipments.assign", "tracking.create", "customers.view"];
const SHIP_COLLEAGUES = [{ id: "01HOPS00000000000000000000", name: "Olu Ops" }, { id: "01HBEA00000000000000000000", name: "Bea Booker" }, { id: "01HCAL00000000000000000000", name: "Cal Carter" }];
const FINANCE_VIEW = ["payments.view"];
const ACCOUNTS_PERMISSIONS = ["payments.view", "payments.record", "invoices.manage", "reports.export"];
const OFFICER_PERMISSIONS = ["customs.manage", "customers.view", "documents.view", "shipments.view"];
const SYSADMIN_PERMISSIONS = ["users.manage", "dashboard.view"];
const BACK_OFFICE = { sysadmin: SYSADMIN_PERMISSIONS, officer: OFFICER_PERMISSIONS, accounts: ACCOUNTS_PERMISSIONS, bookkeeper: FINANCE_VIEW, admin: [...OPS_PERMISSIONS, "refunds.approve", "users.manage"], agent: AGENT_PERMISSIONS, finance: FINANCE_PERMISSIONS, unenrolled: AGENT_PERMISSIONS, ops: OPS_PERMISSIONS, viewer: ["shipments.view"] };

function userFor(key) {
  if (key === "staff") return { id: "01STAFF", name: "Sam Staff", email: "staff@example.test", email_verified: true, roles: ["shipping-agent"], permissions: [], two_factor_enabled: true };
  if (key === "sysadmin") return { id: "01HSYSADMIN000000000000000", name: "Sy Sadmin", email: "sysadmin@example.test", email_verified: true, roles: ["system-admin"], permissions: SYSADMIN_PERMISSIONS, two_factor_enabled: true };
  if (key === "officer") return { id: "01HOFFICER0000000000000000", name: "Olive Officer", email: "officer@example.test", email_verified: true, roles: ["compliance-officer"], permissions: OFFICER_PERMISSIONS, two_factor_enabled: true };
  if (key === "accounts" || key === "bookkeeper") return { id: key === "accounts" ? "01HACCOUNTS000000000000000" : "01HBOOKKEEP000000000000000", name: key === "accounts" ? "Ana Accounts" : "Bo Bookkeeper", email: `${key}@example.test`, email_verified: true, roles: ["finance-officer"], permissions: BACK_OFFICE[key], two_factor_enabled: true };
  if (key === "admin") return { id: "01HADMIN000000000000000000", name: "Ada Admin", email: "admin@example.test", email_verified: true, roles: ["super-admin"], permissions: BACK_OFFICE.admin, two_factor_enabled: true };
  if (key === "ops" || key === "viewer") return { id: key === "ops" ? "01HOPS00000000000000000000" : "01HVIEWER00000000000000000", name: key === "ops" ? "Olu Ops" : "Vera Viewer", email: `${key}@example.test`, email_verified: true, roles: [key === "ops" ? "operations-manager" : "shipping-agent"], permissions: BACK_OFFICE[key], two_factor_enabled: true };
  if (key === "agent" || key === "finance" || key === "unenrolled") return { id: key === "agent" ? "01HAGENT000000000000000000" : key === "finance" ? "01HFINANCE000000000000000" : "01HUNENROLLED0000000000000", name: key === "agent" ? "Alex Agent" : key === "finance" ? "Fran Finance" : "Uma Unenrolled", email: `${key}@example.test`, email_verified: true, roles: [key === "finance" ? "finance-officer" : "customer-support-agent"], permissions: BACK_OFFICE[key], two_factor_enabled: key !== "unenrolled" };
  if (key === "ada") return { id: "01ADA", name: state.auth.adaName ?? "Ada Shipper", email: "ada@example.test", email_verified: true, roles: ["individual-customer"], permissions: [], two_factor_enabled: state.auth.ada2fa, profile: state.auth.profile };
  const registered = state.auth.registered[key];

  return registered ? { id: "01NEW", name: registered.name, email: registered.email, email_verified: false, roles: ["individual-customer"], permissions: [], two_factor_enabled: false } : null;
}

/** Returns true when it handled the request. */
async function handleAuth(request, response, path) {
  if (path === "/sanctum/csrf-cookie") { send(response, 204, null, { "Set-Cookie": [setCookie("XSRF-TOKEN", "stub-csrf-token", { httpOnly: false })] }); return true; }
  if (!path.startsWith("/api/v1/auth/") && !path.startsWith("/api/v1/me")) return false;

  const jar = cookies(request);
  const session = jar.stub_session;

  if (request.method !== "GET" && jar["XSRF-TOKEN"] !== request.headers["x-xsrf-token"]) { err(response, 419, "csrf_token_mismatch", "CSRF token mismatch."); return true; }
  const body = request.method === "GET" ? {} : await readJson(request);
  const signedIn = (key, status = 200) => send(response, status, { data: userFor(key) }, { "Set-Cookie": [setCookie("stub_session", key), setCookie("stub_pending", "", { maxAge: 0 })] });

  if (path === "/api/v1/me" && request.method === "GET") {
    if (userFor(session)) send(response, 200, { data: userFor(session) });
    else err(response, 401, "unauthenticated", "Authentication is required.");

    return true;
  }

  if (path === "/api/v1/auth/login") {
    if (body.email === "throttled@example.test") return err(response, 429, "too_many_requests", "Too many attempts."), true;
    if (body.email === "suspended@example.test" && body.password === currentPassword()) return err(response, 403, "account_suspended", "This account has been suspended."), true;
    if (body.password !== currentPassword() || !["ada@example.test", "staff@example.test", "agent@example.test", "finance@example.test", "unenrolled@example.test", "ops@example.test", "viewer@example.test", "admin@example.test", "accounts@example.test", "bookkeeper@example.test", "officer@example.test", "sysadmin@example.test"].includes(body.email)) return err(response, 401, "invalid_credentials", "These credentials do not match our records."), true;
    if (["agent", "finance", "unenrolled", "ops", "viewer", "admin", "accounts", "bookkeeper", "officer", "sysadmin"].includes(body.email.split("@")[0])) { signedIn(body.email.split("@")[0]); return true; }
    if (body.email === "staff@example.test") {
      state.auth.attempts = 0;
      send(response, 202, { data: { two_factor_required: true } }, { "Set-Cookie": [setCookie("stub_pending", "staff")] });
      return true;
    }
    if (state.auth.ada2fa) { send(response, 202, { data: { two_factor_required: true } }, { "Set-Cookie": [setCookie("stub_pending", "ada")] }); return true; }
    signedIn("ada");
    return true;
  }

  if (path === "/api/v1/auth/two-factor/challenge") {
    const pending = jar.stub_pending;
    if (!pending) return err(response, 401, "two_factor_expired", "Your sign-in expired."), true;
    if (body.code === "123456" || body.recovery_code === "aaaaa-bbbbb") return signedIn(pending), true;
    state.auth.attempts += 1;
    if (state.auth.attempts >= 5) return send(response, 401, { error: { code: "two_factor_locked", message: "Too many incorrect codes." } }, { "Set-Cookie": [setCookie("stub_pending", "", { maxAge: 0 })] }), true;
    return err(response, 422, "invalid_two_factor_code", "That code is not correct."), true;
  }

  if (path === "/api/v1/auth/logout") { send(response, 204, null, { "Set-Cookie": [setCookie("stub_session", "", { maxAge: 0 })] }); return true; }

  if (path === "/api/v1/auth/register") {
    const errors = {};
    if (body.email === "ada@example.test") errors.email = ["The email has already been taken."];
    if (typeof body.password !== "string" || body.password.length < 12) errors.password = ["The password must be at least 12 characters."];
    if (body.password === "Password12345") errors.password = ["The given password has appeared in a data leak. Please choose a different password."];
    if (Object.keys(errors).length) return err(response, 422, "validation_failed", "The given data was invalid.", errors), true;
    state.auth.registered[body.email] = { name: body.name, email: body.email };
    signedIn(body.email, 201);
    return true;
  }

  if (path === "/api/v1/auth/forgot-password") { send(response, 202, { data: { message: "If that account exists, a reset link has been sent." } }); return true; }
  if (path === "/api/v1/auth/reset-password") {
    if (body.token === "good-token") send(response, 200, { data: { message: "Password has been reset." } });
    else err(response, 422, "invalid_reset_token", "This password reset link is invalid or has expired.");

    return true;
  }
  if (path === "/api/v1/auth/email/resend") { send(response, 202, { data: { message: "sent" } }); return true; }

  if (path.startsWith("/api/v1/me/") || (path === "/api/v1/me" && request.method !== "GET")) {
    if (session !== "ada") { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
    const { auth } = state;

    if (path === "/api/v1/me" && request.method === "PATCH") {
      const errors = {};
      if ("timezone" in body && !Intl.supportedValuesOf("timeZone").includes(body.timezone)) errors.timezone = ["The timezone field must be a valid timezone."];
      if ("preferred_currency" in body && !/^[A-Z]{3}$/.test(body.preferred_currency)) errors.preferred_currency = ["The preferred currency field format is invalid."];
      if ("name" in body && (typeof body.name !== "string" || body.name.length > 120)) errors.name = ["The name field must not be greater than 120 characters."];
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      if ("name" in body) auth.adaName = body.name;
      for (const key of ["phone", "locale", "timezone", "preferred_currency"]) if (key in body) auth.profile[key] = body[key];
      auth.lastPatch = body;
      send(response, 200, { data: userFor("ada") });
      return true;
    }
    if (path === "/api/v1/me/password") {
      const errors = {};
      if (body.current_password !== auth.password) errors.current_password = ["The password is incorrect."];
      else if (body.password === "Password12345") errors.password = ["The given password has appeared in a data leak. Please choose a different password."];
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      auth.password = body.password;
      send(response, 204, null);
      return true;
    }
    if (path === "/api/v1/me/export") { send(response, 200, { data: { user: userFor("ada"), addresses: [], organizations: [] } }); return true; }
    if (path === "/api/v1/me/deletion-request") { auth.profile.deletion_requested = true; send(response, 202, { data: { message: "Deletion request recorded." } }); return true; }
  }

  if (path.startsWith("/api/v1/auth/two-factor")) {
    const user = userFor(session);
    if (!user) return err(response, 401, "unauthenticated", "Authentication is required."), true;
    const two = state.auth;
    if (path === "/api/v1/auth/two-factor" && request.method === "GET") {
      const enabled = session === "staff" || two.ada2fa;
      send(response, 200, { data: { enabled, pending_setup: !enabled && two.setupStarted, required: session === "staff", recovery_codes_remaining: enabled ? RECOVERY_CODES.length : null } });
      return true;
    }
    if (path.endsWith("/setup")) { two.setupStarted = true; send(response, 201, { data: { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Stub:ada%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Stub" } }); return true; }
    if (path.endsWith("/confirm")) {
      if (body.code !== "123456") return err(response, 422, "invalid_two_factor_code", "That code is not correct."), true;
      two.ada2fa = true; two.setupStarted = false;
      send(response, 200, { data: { recovery_codes: RECOVERY_CODES } });
      return true;
    }
    if (path.endsWith("/recovery-codes")) {
      if (body.password !== currentPassword()) return err(response, 422, "invalid_password", "The password is not correct."), true;
      send(response, 200, { data: { recovery_codes: RECOVERY_CODES.map((c) => c.replace("code", "newcd")) } });
      return true;
    }
    if (request.method === "DELETE") {
      if (body.password !== currentPassword()) return err(response, 422, "invalid_password", "The password is not correct."), true;
      if (body.code !== "123456" && body.recovery_code !== "aaaaa-bbbbb") return err(response, 422, "invalid_two_factor_code", "That code is not correct."), true;
      two.ada2fa = false;
      send(response, 204, null);
      return true;
    }
  }

  return false;
}

const COUNTRIES = [
  { code: "DE", name: "Germany", dial_code: "+49", currency_code: "EUR", postal_code_required: true, postal_code_pattern: "^\\d{5}$", state_required: false, state_label: "State (optional)" },
  { code: "GB", name: "United Kingdom", dial_code: "+44", currency_code: "GBP", postal_code_required: true, postal_code_pattern: null, state_required: false, state_label: "County (optional)" },
  { code: "NG", name: "Nigeria", dial_code: "+234", currency_code: "NGN", postal_code_required: false, postal_code_pattern: "^\\d{6}$", state_required: true, state_label: "State" },
  { code: "US", name: "United States", dial_code: "+1", currency_code: "USD", postal_code_required: true, postal_code_pattern: "^\\d{5}(-\\d{4})?$", state_required: true, state_label: "State" },
];

const money = (minor, currency = "USD") => ({ amount_minor: minor, amount: (minor / 100).toFixed(2), currency });
const option = (id, slug, name, total, demo = false) => ({
  id, service: { slug, name, category: "economy", is_demo: demo }, estimated_delivery: { min_days: 7, max_days: 13, unit: "days" },
  weights: { actual_g: 2000, volumetric_g: 1200, billable_g: 2000, volumetric_divisor: 5000 },
  line_items: [
    { kind: "base", code: "base", label: "Transportation charge", is_estimate: false, amount: money(total - 701) },
    { kind: "surcharge", code: "fuel", label: "Fuel surcharge", is_estimate: false, amount: money(701) },
    { kind: "duty_estimate", code: "import_duty", label: "Import duty (estimate)", is_estimate: true, amount: money(400) },
  ],
  totals: { charges: money(total), tax: money(0), insurance: money(0), total: money(total), estimated_duties_and_import_taxes: money(400) },
  exchange_rate: null, restrictions: [], required_documents: ["Commercial invoice"], assumptions: ["Duties and import taxes are estimates only and are not included in the total."],
});

function makeQuote(body, id) {
  const declared = body.declared_value ? { amount_minor: Math.round(Number(body.declared_value.amount) * 100), amount: Number(body.declared_value.amount).toFixed(2), currency: body.declared_value.currency } : { amount_minor: 0, amount: "0.00", currency: "USD" };
  const noRoute = body.destination.country === "GB";

  return {
    id, status: "active", currency: "USD", expires_at: new Date(Date.now() + 86400000).toISOString(), accepted_option_id: null,
    shipment: { origin: { country: body.origin.country, city: body.origin.city, postal: body.origin.postal_code ?? null }, destination: { country: body.destination.country, city: body.destination.city, postal: body.destination.postal_code ?? null }, shipment_type: body.shipment_type, contents: body.contents, package_count: body.packages.length, declared_value: declared },
    options: noRoute ? [] : [option(`${id}OPT1`, "international-economy", "International Economy", 7041, true), option(`${id}OPT2`, "international-express", "International Express", 11250)],
    unavailable: noRoute ? [{ service: "international-economy", name: "International Economy", reasons: ["route_not_served"] }] : [{ service: "air-freight", name: "Air Freight", reasons: ["shipment_type_not_supported", "package_too_light"] }],
  };
}

const partyRules = (body, role, errors) => {
  const p = body[role] ?? {};
  if (!p.name) errors[`${role}.name`] = ["The name field is required."];
  if (!/^\+?[0-9 ()-]{6,30}$/.test(p.phone ?? "")) errors[`${role}.phone`] = ["The phone field format is invalid."];
  if (!p.line1) errors[`${role}.line1`] = ["The line1 field is required."];
  const country = COUNTRIES.find((c) => c.code === p.country);
  if (country?.state_required && !p.state) errors[`${role}.state`] = [`${country.state_label} is required for this country.`];
};

const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];
const DOC_TYPES = ["commercial_invoice", "packing_list", "export_licence", "certificate_of_origin", "import_permit", "identification", "other"];

/** Just enough multipart parsing for one file and a few text fields. */
function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  const fields = {};
  let file = null;
  const files = [];
  if (!boundary) return { fields, file, files };

  for (const part of buffer.toString("binary").split(`--${boundary}`).slice(1, -1)) {
    const [head, ...rest] = part.split("\r\n\r\n");
    const name = head.match(/name="([^"]+)"/)?.[1];
    const content = rest.join("\r\n\r\n").replace(/\r\n$/, "");
    const filename = head.match(/filename="([^"]*)"/)?.[1];
    if (filename !== undefined) { file = { name, filename, data: Buffer.from(content, "binary") }; files.push(file); }
    else if (name) fields[name] = content;
  }

  return { fields, file, files };
}

const looksLikeAllowedFile = (data) => data.subarray(0, 4).toString("latin1") === "%PDF" || (data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") || (data[0] === 0xff && data[1] === 0xd8);

const ATTACH_LIMITS = { perRequest: 5, perParent: 20, bytes: 10 * 1024 * 1024 };

/** Mirrors the backend rules: every file is checked before any is kept. Returns an error response body or null. */
function attachmentProblem(files, existing) {
  if (files.length > ATTACH_LIMITS.perRequest) return { status: 422, code: "validation_failed", message: "The given data was invalid.", errors: { attachments: [`You may not attach more than ${ATTACH_LIMITS.perRequest} files at once.`] } };
  if (existing + files.length > ATTACH_LIMITS.perParent) return { status: 422, code: "too_many_attachments", message: `This already has ${existing} attachments; the limit is ${ATTACH_LIMITS.perParent}.` };
  for (const f of files) {
    if (f.data.length === 0) return { status: 422, code: "unsupported_attachment", message: `“${f.filename}” is empty.` };
    if (f.data.length > ATTACH_LIMITS.bytes) return { status: 422, code: "attachment_too_large", message: `“${f.filename}” is larger than 10 MB.` };
    if (!looksLikeAllowedFile(f.data)) return { status: 422, code: "unsupported_attachment", message: `“${f.filename}” isn't a PDF, JPEG or PNG file.` };
  }

  return null;
}

const customsOverview = (shipment) => {
  const international = shipment.sender?.country !== shipment.recipient?.country;
  const has = (type) => shipment.documents.some((d) => d.type === type);
  const requirements = international ? [
    { id: 1, direction: "export", document_type: "export_licence", label: "Export licence", mandatory: true, notes: "Needed for goods leaving Nigeria.", status: has("export_licence") ? "satisfied" : "missing", reason: has("export_licence") ? null : "No export licence on file." },
    { id: 2, direction: "import", document_type: "commercial_invoice", label: "Commercial invoice", mandatory: true, notes: null, status: has("commercial_invoice") ? "satisfied" : "missing", reason: has("commercial_invoice") ? null : "No commercial invoice on file." },
    { id: 3, direction: "import", document_type: "packing_list", label: "Packing list", mandatory: false, notes: null, status: has("packing_list") ? "satisfied" : "missing", reason: has("packing_list") ? null : "No packing list on file." },
  ] : [];

  return {
    international, declaration: shipment.declaration ?? null, requirements,
    ready_for_export: requirements.filter((r) => r.direction === "export" && r.mandatory).every((r) => r.status === "satisfied"),
    compliance: shipment.compliance ?? { status: "clear", note: null },
    estimates: { note: "Estimates from your quote. They are not charges and not included in what you paid; the amounts customs actually assess may differ.", items: international ? [{ label: "Import duty (estimate)", amount_minor: 400, currency: "USD" }] : [] },
    assessed_charges: { note: "Amounts assessed by the customs authority of the destination country, payable separately from your shipping invoice.", items: shipment.charges ?? [] },
  };
};

const BEFORE_CUSTOMS = ["booking_pending", "booking_confirmed", "awaiting_pickup", "pickup_scheduled", "picked_up", "received_at_origin", "processing_at_origin"];

const publicShipment = (shipment) => {
  const copy = { ...shipment, documents: (shipment.documents ?? []).map((d) => ({ ...d, removable: !d.generated && BEFORE_CUSTOMS.includes(shipment.status) })) };
  delete copy.guestToken;
  delete copy.owner;
  delete copy.pendingPolls;
  delete copy.declaration;
  delete copy.compliance;
  delete copy.charges;

  return copy;
};

const invoiceOf = (shipment) => {
  const refunded = shipment.payment.refunded?.amount_minor ?? 0;

  return {
    id: shipment.payment.invoice_id, number: shipment.payment.invoice_number, status: shipment.payment.status === "paid" ? "paid" : shipment.payment.status === "void" ? "void" : "issued", kind: "prepaid",
    shipment_id: shipment.id, tracking_number: shipment.tracking_number, subtotal: shipment.total, tax: money(0), total: shipment.total, refunded: money(refunded), billing_name: shipment.sender?.name ?? null,
    issued_at: shipment.created_at, due_at: null, paid_at: shipment.payment.status === "paid" || refunded > 0 ? shipment.created_at : null,
    items: [{ kind: "base", description: "Transportation charge", amount: shipment.total }],
    credit_notes: refunded > 0 ? [{ number: shipment.payment.invoice_number.replace("INV", "CN"), amount: money(refunded), issued_at: shipment.created_at }] : [],
  };
};

const paginate = (items, request, url, pageSize) => {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const lastPage = Math.max(1, Math.ceil(items.length / pageSize));

  return { data: items.slice((page - 1) * pageSize, page * pageSize), meta: { current_page: page, last_page: lastPage, total: items.length, per_page: pageSize }, links: {} };
};

/** Quotes, bookings, payments. Returns true when it handled the request. */
/** The back-office API, for the ticket and claim queues. Tickets and claims customers create in other tests show up here too. */
async function handleAdmin(request, response, path, url) {
  if (!path.startsWith("/api/v1/admin/")) return false;

  const jar = cookies(request);
  const session = jar.stub_session || null;
  const user = userFor(session);
  if (!user) { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
  if (request.method !== "GET" && jar["XSRF-TOKEN"] !== request.headers["x-xsrf-token"]) { err(response, 419, "csrf_token_mismatch", "CSRF token mismatch."); return true; }
  if (session === "unenrolled") { err(response, 403, "two_factor_enrollment_required", "Set up two-factor authentication to use the back office."); return true; }

  const need = (permission) => { if (user.permissions.includes(permission)) return true; err(response, 403, "forbidden", "This action is unauthorized."); return false; };
  const multipart = (request.headers["content-type"] ?? "").startsWith("multipart/form-data");
  const form = multipart ? parseMultipart(Buffer.concat(await (async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return chunks; })()), request.headers["content-type"]) : null;
  const body = request.method === "GET" ? {} : multipart ? { ...form.fields, ...("internal" in form.fields ? { internal: form.fields.internal === "1" || form.fields.internal === "true" } : {}) } : await readJson(request);
  const sent = form?.files ?? [];
  const { shop } = state;
  shop.tickets ??= {};
  shop.claims ??= {};
  shop.adminLog ??= [];
  shop.attachmentCount ??= 0;
  const keepFiles = (files) => files.map((f) => {
    const id = `ATT${++shop.attachmentCount}`;
    const type = f.data.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : f.data[0] === 0x89 ? "image/png" : "image/jpeg";
    shop.lastAttachments = [...(shop.lastAttachments ?? []), { name: f.filename, bytes: f.data.length, by: "staff" }];

    return { id, name: f.filename, size: f.data.length, type };
  });
  const countFiles = (items) => items.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);
  const pageSize = shop.adminPageSize ?? 25;
  const paged = (items) => {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

    return { data: items.slice((page - 1) * pageSize, page * pageSize), meta: { total: items.length, last_page: Math.max(1, Math.ceil(items.length / pageSize)) } };
  };

  // ---- tickets
  const rank = { urgent: 1, high: 2, normal: 3, low: 4 };
  const ticketSummary = (t) => ({
    id: t.id, number: t.number, subject: t.subject, category: t.category, priority: t.priority ?? "normal", status: t.status,
    requester: t.owner === "ada" ? { id: "01ADA", name: "Ada Shipper", email: "ada@example.test" } : { email: t.email ?? "guest@example.test" },
    tracking_number: t.tracking_number ?? null, assigned_to: t.assigned_to ?? null, assignee: COLLEAGUES.find((c) => c.id === t.assigned_to) ?? null,
    first_response_due_at: t.first_response_due_at ?? new Date(Date.parse(t.created_at ?? t.last_activity_at) + 4 * 3600_000).toISOString(), first_response_at: t.first_response_at ?? null,
    sla_breached: !t.first_response_at && ["open", "pending_staff"].includes(t.status) && Date.parse(t.first_response_due_at ?? "2999-01-01") < Date.now(),
    last_activity_at: t.last_activity_at, created_at: t.created_at ?? t.last_activity_at,
  });
  const ticketDetail = (t) => ({ ...ticketSummary(t), messages: t.messages.map((m, i) => ({ id: i + 1, from: m.from, internal: Boolean(m.internal), body: m.body, author: m.from === "staff" ? "01HAGENT000000000000000000" : null, created_at: m.created_at, attachments: m.attachments ?? [] })) });

  if (path === "/api/v1/admin/tickets" && request.method === "GET") {
    if (!need("tickets.manage")) return true;
    if (url.searchParams.has("breached") && !["1", "0"].includes(url.searchParams.get("breached"))) { err(response, 422, "validation_failed", "The given data was invalid.", { breached: ["The breached field must be true or false."] }); return true; }
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const items = Object.values(shop.tickets).map((t) => ({ s: ticketSummary(t) })).filter(({ s }) =>
      (!url.searchParams.get("status") || s.status === url.searchParams.get("status")) && (!url.searchParams.get("priority") || s.priority === url.searchParams.get("priority"))
      && (!url.searchParams.get("category") || s.category === url.searchParams.get("category"))
      && (url.searchParams.get("breached") !== "1" || s.sla_breached)
      && (!url.searchParams.get("assigned_to") || (url.searchParams.get("assigned_to") === "unassigned" ? s.assigned_to === null : url.searchParams.get("assigned_to") === "me" ? s.assigned_to === user.id : s.assigned_to === url.searchParams.get("assigned_to")))
      && (!q || s.number.toLowerCase().includes(q) || s.subject.toLowerCase().includes(q)),
    ).map(({ s }) => s).sort((a, b) => rank[a.priority] - rank[b.priority]);
    shop.lastAdminTicketQuery = Object.fromEntries(url.searchParams.entries());
    send(response, 200, paged(items));
    return true;
  }

  if (path === "/api/v1/admin/tickets/assignees" && request.method === "GET") {
    if (!need("tickets.manage")) return true;
    send(response, 200, { data: COLLEAGUES });
    return true;
  }

  const ticketRoute = path.match(/^\/api\/v1\/admin\/tickets\/([^/]+)(\/messages|\/attachments\/[^/]+)?$/);
  if (ticketRoute) {
    if (!need("tickets.manage")) return true;
    const t = shop.tickets[ticketRoute[1]];
    if (!t) { err(response, 404, "not_found", "The requested resource was not found."); return true; }

    if (ticketRoute[2]?.startsWith("/attachments/") && request.method === "GET") {
      const id = ticketRoute[2].slice("/attachments/".length);
      if (!t.messages.some((m) => m.attachments?.some((a) => a.id === id))) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      send(response, 200, { data: { url: `http://localhost:${PORT}/api/v1/documents/${id}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });
      return true;
    }

    if (ticketRoute[2] === "/messages" && request.method === "POST") {
      if (!body.message) { err(response, 422, "validation_failed", "The given data was invalid.", { message: ["The message field is required."] }); return true; }
      const problem = attachmentProblem(sent, countFiles(t.messages));
      if (problem) { err(response, problem.status, problem.code, problem.message, problem.errors); return true; }
      t.messages.push({ from: "staff", body: body.message, internal: Boolean(body.internal), created_at: new Date().toISOString(), attachments: keepFiles(sent) });
      if (!body.internal) {
        t.first_response_at ??= new Date().toISOString();
        t.status = body.status ?? "pending_customer";
      }
      t.last_activity_at = new Date().toISOString();
      shop.adminLog.push(`reply:${t.id}:${body.internal ? "internal" : "public"}:${body.status ?? ""}`);
      send(response, 200, { data: ticketDetail(t) });
      return true;
    }

    if (request.method === "PATCH") {
      if (body.assigned_to && !COLLEAGUES.some((c) => c.id === body.assigned_to)) { err(response, 422, "validation_failed", "The given data was invalid.", { assigned_to: ["That person cannot be assigned tickets."] }); return true; }
      for (const key of ["status", "priority", "category"]) if (body[key] !== undefined) t[key] = body[key];
      if ("assigned_to" in body) t.assigned_to = body.assigned_to;
      t.last_activity_at = new Date().toISOString();
      shop.adminLog.push(`update:${t.id}:${JSON.stringify(body)}`);
      send(response, 200, { data: ticketSummary(t) });
      return true;
    }

    send(response, 200, { data: ticketDetail(t) });
    return true;
  }

  // ---- claims
  const claimSummary = (c) => ({ id: c.id, number: c.number, status: c.status, type: c.type, tracking_number: c.tracking_number, claimed: c.claimed, approved: c.approved ?? null, paid: c.paid ?? null, created_at: c.created_at });
  const claimDetail = (c) => {
    const ship = shop.shipments[c.shipment_id];

    return {
      ...claimSummary(c), description: c.description, incident_date: c.incident_date, resolution_note: c.resolution_note ?? null, decided_at: c.decided_at ?? null, insured: false,
      attachments: c.attachments ?? [], notes: c.notes.map((n) => ({ from: n.from, internal: Boolean(n.internal), body: n.body, created_at: n.created_at, attachments: n.attachments ?? [] })),
      limits: { currency: "USD", cap_minor: ship?.total?.amount_minor ?? c.claimed.amount_minor, insured: false },
    };
  };

  if (path === "/api/v1/admin/claims" && request.method === "GET") {
    if (!CLAIM_READERS.some((p) => user.permissions.includes(p))) { err(response, 403, "forbidden", "This action is unauthorized."); return true; }
    const items = Object.values(shop.claims).filter((c) => (!url.searchParams.get("status") || c.status === url.searchParams.get("status")) && (!url.searchParams.get("type") || c.type === url.searchParams.get("type"))).reverse().map(claimSummary);
    send(response, 200, paged(items));
    return true;
  }

  const claimRoute = path.match(/^\/api\/v1\/admin\/claims\/([^/]+)(\/review|\/notes|\/decision|\/payout|\/attachments\/[^/]+)?$/);
  if (claimRoute) {
    const reads = request.method === "GET";
    const decides = claimRoute[2] === "/decision" || claimRoute[2] === "/payout";   // those check their own, narrower permission below
    if (reads && !CLAIM_READERS.some((p) => user.permissions.includes(p))) { err(response, 403, "forbidden", "This action is unauthorized."); return true; }
    if (!reads && !decides && !need("claims.manage")) return true;
    const c = shop.claims[claimRoute[1]];
    if (!c) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    const sub = claimRoute[2];

    if (sub?.startsWith("/attachments/")) {
      const id = sub.slice("/attachments/".length);
      if (!(c.attachments ?? []).some((a) => a.id === id) && !c.notes.some((n) => n.attachments?.some((a) => a.id === id))) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      send(response, 200, { data: { url: `http://localhost:${PORT}/api/v1/documents/${id}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });
      return true;
    }

    const conflict = (message) => { err(response, 409, "claim_state", message); return true; };

    if (sub === "/review") {
      const allowed = { submitted: ["under_review", "info_requested"], under_review: ["info_requested"], info_requested: ["under_review"] }[c.status] ?? [];
      if (!allowed.includes(body.status)) return conflict(`A claim that is ${c.status} cannot move to ${body.status}.`);
      if (body.status === "info_requested" && !body.note) { err(response, 422, "validation_failed", "The given data was invalid.", { note: ["The note field is required when status is info_requested."] }); return true; }
      c.status = body.status;
      if (body.note) c.notes.push({ from: "staff", body: body.note, created_at: new Date().toISOString(), attachments: [] });
      shop.adminLog.push(`review:${c.id}:${body.status}`);
      send(response, 200, { data: claimDetail(c) });
      return true;
    }

    if (sub === "/notes") {
      const problem = attachmentProblem(sent, countFiles(c.notes) + (c.attachments?.length ?? 0));
      if (problem) { err(response, problem.status, problem.code, problem.message, problem.errors); return true; }
      c.notes.push({ from: "staff", body: body.body, internal: body.internal ?? true, created_at: new Date().toISOString(), attachments: keepFiles(sent) });
      shop.adminLog.push(`note:${c.id}:${body.internal ?? true ? "internal" : "public"}`);
      send(response, 201, { data: claimDetail(c) });
      return true;
    }

    if (sub === "/decision") {
      if (!need("claims.approve")) return true;
      if (!["submitted", "under_review"].includes(c.status)) return conflict(`A claim that is ${c.status} cannot be decided.`);
      if (body.decision === "approve") {
        const minor = Math.round(Number(body.approved_amount) * 100);
        if (!(minor >= 1 && minor <= c.claimed.amount_minor)) { err(response, 422, "validation_failed", "The given data was invalid.", { approved_minor: [`Approve an amount between 1 and the claimed amount (${c.claimed.amount_minor}).`] }); return true; }
        c.approved = money(minor);
      }
      c.status = body.decision === "approve" ? "approved" : "rejected";
      c.resolution_note = body.note;
      c.decided_at = new Date().toISOString();
      shop.adminLog.push(`decision:${c.id}:${body.decision}:${body.approved_amount ?? ""}`);
      send(response, 200, { data: claimDetail(c) });
      return true;
    }

    if (sub === "/payout") {
      if (!need("refunds.approve")) return true;
      if (c.status !== "approved") return conflict("Only an approved claim can be paid out.");
      const key = request.headers["idempotency-key"];
      shop.payoutKeys ??= {};
      if (key && shop.payoutKeys[key]) { send(response, 200, { data: claimDetail(c) }, { "Idempotent-Replayed": "true" }); return true; }
      if (key) shop.payoutKeys[key] = true;
      c.paid = c.approved;
      c.status = "paid";
      shop.adminLog.push(`payout:${c.id}:${body.method}:${body.reference ?? ""}`);
      send(response, 200, { data: claimDetail(c) });
      return true;
    }

    send(response, 200, { data: claimDetail(c) });
    return true;
  }


  // ---- shipments
  const NEXT_STATUS = {
    booking_confirmed: ["awaiting_pickup", "picked_up"], awaiting_pickup: ["picked_up"], picked_up: ["received_at_origin"], received_at_origin: ["processing_at_origin"],
    processing_at_origin: ["export_clearance", "departed_origin"], export_clearance: ["departed_origin"], departed_origin: ["in_transit"], in_transit: ["arrived_destination_country", "exception"],
    arrived_destination_country: ["import_clearance", "out_for_delivery"], out_for_delivery: ["delivered", "delivery_attempted", "exception"], exception: ["in_transit", "out_for_delivery"],
  };
  const PRE_COLLECTION = ["booking_confirmed", "awaiting_pickup", "pickup_scheduled"];
  const labelOf = (code) => code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const piiOk = user.permissions.includes("customers.view");
  const STAGE = { delivered: ["delivered"], exceptions: ["exception"], in_transit: ["in_transit", "departed_origin"], cancelled: ["cancelled"] };
  const adminOf = (sh) => (sh.admin ??= { assigned_to: null, notes: [], events: [{ id: `EV-${sh.id}-0`, status: sh.status, occurred_at: sh.created_at, source: "system", description: null, internal_note: null, is_public: true, applied: true, rejection_reason: null, recipient_name: null, reason: null, location: {} }] });
  const shipRow = (sh) => ({
    id: sh.id, tracking_number: sh.tracking_number, status: { code: sh.status, label: sh.status_label ?? labelOf(sh.status) }, service: sh.service?.name ?? "International Economy", created_at: sh.created_at, status_changed_at: sh.status_changed_at ?? null,
    origin: { city: sh.sender?.city ?? null, country: sh.sender?.country ?? null }, destination: { city: sh.recipient?.city ?? null, country: sh.recipient?.country ?? null },
    total: sh.total, payment_status: sh.payment?.status ?? null, assigned_to: adminOf(sh).assigned_to, assignee: SHIP_COLLEAGUES.find((c) => c.id === adminOf(sh).assigned_to) ?? null, facility: null,
    delayed: Boolean(sh.delayed), compliance_status: sh.complianceState?.status ?? "clear", customer: piiOk ? { name: "Ada Shipper", email: sh.guestEmail ?? "ada@example.test" } : null,
  });
  const shipTracking = (sh) => ({
    tracking_number: sh.tracking_number, status: { code: sh.status, label: sh.status_label ?? labelOf(sh.status) }, international: sh.sender?.country !== sh.recipient?.country,
    allowed_next: (NEXT_STATUS[sh.status] ?? []).map((code) => ({ code, label: labelOf(code) })),
    events: adminOf(sh).events.map((e) => ({ id: e.id, status: { code: e.status, label: labelOf(e.status) }, description: e.description, occurred_at: e.occurred_at, timezone: "UTC", location: { city: e.location?.city ?? null, country: e.location?.country ?? null, facility: e.location?.facility ?? null }, source: e.source, reason: e.reason, internal_note: e.internal_note, is_public: e.is_public, applied: e.applied, rejection_reason: e.rejection_reason, recipient_name: e.recipient_name })),
  });
  const shipDetail = (sh) => ({
    ...shipRow(sh),
    sender: piiOk ? sh.sender : { redacted: true, city: sh.sender?.city ?? null, country: sh.sender?.country ?? null }, recipient: piiOk ? sh.recipient : { redacted: true, city: sh.recipient?.city ?? null, country: sh.recipient?.country ?? null },
    compliance: { status: sh.complianceState?.status ?? "clear", note: sh.complianceState?.note ?? null, reviewed_at: sh.complianceState?.reviewed_at ?? null, findings: sh.complianceState?.findings ?? [] },
    contents: sh.contents ?? "Clothing", declared_value: { amount_minor: 10000, currency: "USD" }, insurance_requested: false, billable_weight_g: 2000,
    packages: [{ type: "box", weight_g: 2000, length_mm: 300, width_mm: 200, height_mm: 100 }], items: (sh.items ?? []).map((it) => ({ description: it.description, quantity: it.quantity, unit_value_minor: it.unit_value_minor, currency_code: it.currency ?? "USD", hs_code: it.hs_code ?? null, origin_country: it.origin_country ?? null })), pickup_instructions: null, delivery_instructions: null,
    invoice: sh.payment ? { id: sh.payment.invoice_id, number: sh.payment.invoice_number, status: sh.payment.status, kind: "prepaid", total_minor: sh.total.amount_minor, refunded_minor: sh.refundedMinor ?? 0, refundable_minor: sh.payment.status === "paid" || sh.payment.status === "partially_refunded" ? sh.total.amount_minor - (sh.refundedMinor ?? 0) : 0 } : null, pickups: [],
    cancellable: PRE_COLLECTION.includes(sh.status), cancellation_reason: sh.cancellation_reason ?? null,
    documents: (sh.documents ?? []).map((d) => ({ id: d.id, type: d.type, name: d.name, size: d.size ?? 0, generated: Boolean(d.generated), event: d.event ?? null })),
    notes: adminOf(sh).notes, tracking: shipTracking(sh), is_demo: true,
  });

  if (path === "/api/v1/admin/shipments/assignees" && request.method === "GET") {
    if (!need("shipments.assign")) return true;
    send(response, 200, { data: SHIP_COLLEAGUES });
    return true;
  }

  if (path === "/api/v1/admin/shipments" && request.method === "GET") {
    if (!need("shipments.view")) return true;
    const q = (url.searchParams.get("q") ?? "").trim();
    const stage = url.searchParams.get("stage");
    const assigned = url.searchParams.get("assigned_to");
    let items = Object.values(shop.shipments).filter((sh) =>
      (!q || sh.tracking_number.includes(q.toUpperCase())) && (!stage || (stage === "delayed" ? sh.delayed : (STAGE[stage] ?? []).includes(sh.status)))
      && (!assigned || (assigned === "unassigned" ? adminOf(sh).assigned_to === null : assigned === "me" ? adminOf(sh).assigned_to === user.id : adminOf(sh).assigned_to === assigned)));
    const sort = url.searchParams.get("sort") ?? "created_at";
    const dir = url.searchParams.get("dir") === "asc" ? 1 : -1;
    items = items.sort((a, b) => dir * String(a[sort] ?? a.created_at).localeCompare(String(b[sort] ?? b.created_at)));
    shop.lastAdminShipmentQuery = Object.fromEntries(url.searchParams.entries());
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    send(response, 200, { data: items.slice((page - 1) * pageSize, page * pageSize).map(shipRow), meta: { total: items.length, current_page: page, last_page: Math.max(1, Math.ceil(items.length / pageSize)), search_limited: q && !piiOk && !/^[A-Za-z0-9._-]{6,40}$/.test(q) ? "Searching by name or email needs the customers.view permission." : null } });
    return true;
  }

  const shipRoute = path.match(/^\/api\/v1\/admin\/shipments\/([^/]+)(\/notes|\/assignment|\/tracking-events|\/cancel|\/refund|\/compliance|\/customs|\/customs-charges|\/tracking-events\/[^/]+\/proof)?$/);
  if (shipRoute) {
    if (!need("shipments.view")) return true;
    const sh = shop.shipments[shipRoute[1]];
    if (!sh) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    const sub = shipRoute[2];

    if (sub === "/notes" && request.method === "POST") {
      if (!need("shipments.update")) return true;
      adminOf(sh).notes.push({ id: adminOf(sh).notes.length + 1, body: body.body, created_at: new Date().toISOString() });
      shop.adminLog.push(`ship-note:${sh.tracking_number}`);
      send(response, 201, { data: { id: adminOf(sh).notes.length, body: body.body, created_at: new Date().toISOString() } });
      return true;
    }

    if (sub === "/assignment" && request.method === "PATCH") {
      if (!need("shipments.assign")) return true;
      if (body.assigned_to && !SHIP_COLLEAGUES.some((c) => c.id === body.assigned_to)) { err(response, 422, "not_staff", "Shipments can only be assigned to active staff who can work on shipments."); return true; }
      adminOf(sh).assigned_to = body.assigned_to ?? null;
      shop.adminLog.push(`ship-assign:${sh.tracking_number}:${body.assigned_to ?? "none"}`);
      send(response, 200, { data: shipRow(sh) });
      return true;
    }

    if (sub === "/cancel" && request.method === "POST") {
      if (!need("shipments.update")) return true;
      if (!body.reason) { err(response, 422, "validation_failed", "The given data was invalid.", { reason: ["The reason field is required."] }); return true; }
      if (!PRE_COLLECTION.includes(sh.status)) { err(response, 409, "shipment_collected", "This shipment has already been collected and can no longer be cancelled here."); return true; }
      if (sh.payment?.status === "paid") { sh.refundedMinor = sh.total.amount_minor; sh.payment.status = "refunded"; sh.payment.refunded = sh.total; }
      adminOf(sh).events.push({ id: `EV-${sh.id}-${adminOf(sh).events.length}`, status: "cancelled", occurred_at: new Date().toISOString(), source: "staff", description: "Booking cancelled", internal_note: null, is_public: true, applied: true, rejection_reason: null, recipient_name: null, reason: null, location: {} });
      sh.status = "cancelled";
      sh.status_label = "Cancelled";
      sh.cancellation_reason = body.reason;
      sh.cancellable = false;
      shop.adminLog.push(`ship-cancel:${sh.tracking_number}:${body.reason}`);
      send(response, 200, { data: shipRow(sh) });
      return true;
    }

    if (sub === "/refund" && request.method === "POST") {
      if (!need("refunds.approve")) return true;
      const key = request.headers["idempotency-key"];
      if (!key) { err(response, 422, "idempotency_key_required", "An Idempotency-Key header (8–128 letters, digits or . _ : -) is required."); return true; }
      shop.refundKeys ??= {};
      if (shop.refundKeys[key]) { send(response, 201, { data: { refund_id: "R-REPLAY" } }); return true; }
      if (!body.reason) { err(response, 422, "validation_failed", "The given data was invalid.", { reason: ["The reason field is required."] }); return true; }
      if (!["paid", "partially_refunded"].includes(sh.payment?.status)) { err(response, 409, "nothing_to_refund", "This invoice has not been paid."); return true; }
      const refundable = sh.total.amount_minor - (sh.refundedMinor ?? 0);
      const minor = body.amount === undefined ? refundable : Math.round(Number(body.amount) * 100);
      if (!(minor > 0 && minor <= refundable)) { err(response, 422, "refund_exceeds_balance", `At most ${(refundable / 100).toFixed(2)} USD can still be refunded.`); return true; }
      shop.refundKeys[key] = true;
      sh.refundedMinor = (sh.refundedMinor ?? 0) + minor;
      sh.payment.status = sh.refundedMinor >= sh.total.amount_minor ? "refunded" : "partially_refunded";
      shop.adminLog.push(`ship-refund:${sh.tracking_number}:${(minor / 100).toFixed(2)}:${body.reason}`);
      send(response, 201, { data: { refund_id: "R1", amount_minor: minor } });
      return true;
    }

    if (sub?.startsWith("/tracking-events/") && sub.endsWith("/proof") && request.method === "POST") {
      if (!need("tracking.create")) return true;
      const eventId = sub.split("/")[2];
      const event = adminOf(sh).events.find((e) => e.id === eventId);
      if (!event || event.status !== "delivered" || !event.applied) { err(response, 422, "not_a_delivery_event", "Proof can only be attached to a delivery event."); return true; }
      const file = sent[0];
      if (!file || !looksLikeAllowedFile(file.data)) { err(response, 422, "unsupported_media_type", "Only PDF, JPEG and PNG documents are accepted."); return true; }
      sh.documents ??= [];
      const doc = { id: `PRF${sh.documents.length + 1}${sh.id}`, type: "proof_of_delivery", name: file.filename, size: file.data.length, generated: false, event: eventId };
      sh.documents.push(doc);
      shop.adminLog.push(`proof:${sh.tracking_number}:${file.filename}`);
      send(response, 201, { data: { id: doc.id, type: doc.type, name: doc.name, size: doc.size, event: eventId } });
      return true;
    }

    if (sub === "/compliance" && request.method === "POST") {
      if (!need("customs.manage")) return true;
      if (sh.complianceState?.status !== "review_required") { err(response, 409, "no_review_pending", "This shipment is not waiting for compliance review."); return true; }
      if (!body.note) { err(response, 422, "validation_failed", "The given data was invalid.", { note: ["The note field is required."] }); return true; }
      const approve = body.decision === "approve";
      sh.complianceState = { ...sh.complianceState, status: approve ? "approved" : "rejected", note: body.note, reviewed_at: new Date().toISOString() };
      if (!approve) {
        if (sh.payment?.status === "paid") { sh.refundedMinor = sh.total.amount_minor; sh.payment.status = "refunded"; }
        sh.status = "cancelled";
        sh.status_label = "Cancelled";
        sh.cancellation_reason = "Rejected by compliance review";
      }
      shop.adminLog.push(`compliance:${sh.tracking_number}:${body.decision}:${body.note}`);
      send(response, 200, { data: { status: sh.status, compliance_status: sh.complianceState.status } });
      return true;
    }

    if (sub === "/customs" && request.method === "GET") {
      if (!need("customs.manage")) return true;
      const international = sh.sender?.country !== sh.recipient?.country;
      sh.chargeList ??= (sh.charges ?? []).map((c, n) => ({ id: c.id ?? `CHG-${n + 1}`, type: c.type ?? "duty", description: c.description ?? c.label ?? "Charge", amount_minor: c.amount_minor, currency: c.currency ?? "USD", assessed_by: c.assessed_by ?? null, authority_reference: c.authority_reference ?? null, status: c.status ?? "assessed", paid_at: c.paid_at ?? null }));
      const base = customsOverview(sh);
      send(response, 200, { data: { international, declaration: base.declaration, requirements: base.requirements, ready_for_export: base.ready_for_export, estimates: { note: base.estimates.note, items: international ? [{ label: "Import duty (estimate)", amount_minor: 400, currency: "USD" }] : [] }, assessed_charges: { note: base.assessed_charges.note, items: sh.chargeList } } });
      return true;
    }

    if (sub === "/customs-charges" && request.method === "POST") {
      if (!need("customs.manage")) return true;
      const errors = {};
      if (!body.description) errors.description = ["The description field is required."];
      if (!/^\d{1,12}(\.\d{1,4})?$/.test(body.amount ?? "")) errors.amount = ["The amount field format is invalid."];
      if (!body.assessed_by) errors.assessed_by = ["The assessed by field is required."];
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      if (sh.sender?.country === sh.recipient?.country) { err(response, 422, "not_international", "Customs charges only apply to cross-border shipments."); return true; }
      sh.chargeList ??= [];
      sh.chargeList.push({ id: `CHG-NEW${sh.chargeList.length + 1}`, type: body.type, description: body.description, amount_minor: Math.round(Number(body.amount) * 100), currency: body.currency, assessed_by: body.assessed_by, authority_reference: body.authority_reference ?? null, status: "assessed", paid_at: null });
      shop.adminLog.push(`charge:${sh.tracking_number}:${body.type}:${body.amount}:${body.currency}`);
      send(response, 201, { data: sh.chargeList.at(-1) });
      return true;
    }

    if (sub === "/tracking-events" && request.method === "POST") {
      if (!need("tracking.create")) return true;
      const allowed = NEXT_STATUS[sh.status] ?? [];
      if (!allowed.includes(body.status)) { err(response, 422, "invalid_transition", `A shipment that is “${labelOf(sh.status)}” cannot be moved to “${labelOf(String(body.status))}” by hand.`); return true; }
      if (body.occurred_at && Date.parse(body.occurred_at) > Date.now() + 5 * 60_000) { err(response, 422, "validation_failed", "The given data was invalid.", { occurred_at: ["The occurred at field must be a date before or equal to +5 minutes."] }); return true; }
      adminOf(sh).events.push({ id: `EV-${sh.id}-${adminOf(sh).events.length}`, status: body.status, occurred_at: body.occurred_at ?? new Date().toISOString(), source: "staff", description: body.description ?? null, internal_note: body.internal_note ?? null, is_public: body.is_public ?? true, applied: true, rejection_reason: null, recipient_name: body.recipient_name ?? null, reason: body.exception_code ? labelOf(body.exception_code) : null, location: body.location ?? {} });
      sh.status = body.status;
      sh.status_label = labelOf(body.status);
      sh.status_changed_at = new Date().toISOString();
      shop.lastTrackingUpdate = body;
      shop.adminLog.push(`track:${sh.tracking_number}:${body.status}:${body.is_public ?? true ? "public" : "private"}`);
      send(response, 201, { data: shipTracking(sh) });
      return true;
    }

    send(response, 200, { data: shipDetail(sh) });
    return true;
  }

  const chargeRoute = path.match(/^\/api\/v1\/admin\/customs-charges\/([^/]+)\/(payment|waive)$/);
  if (chargeRoute && request.method === "POST") {
    if (!need("customs.manage")) return true;
    const owner = Object.values(shop.shipments).find((sh) => (sh.chargeList ?? []).some((c) => c.id === chargeRoute[1]));
    const charge = owner?.chargeList.find((c) => c.id === chargeRoute[1]);
    if (!charge) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (charge.status !== "assessed") { err(response, 409, "charge_not_payable", `This charge is ${charge.status}.`); return true; }
    if (chargeRoute[2] === "payment") {
      if (!body.reference) { err(response, 422, "validation_failed", "The given data was invalid.", { reference: ["The reference field is required."] }); return true; }
      charge.status = "paid";
      charge.paid_at = new Date().toISOString();
      shop.adminLog.push(`charge-paid:${charge.id}:${body.payer}:${body.reference}`);
    } else {
      charge.status = "waived";
      shop.adminLog.push(`charge-waived:${charge.id}`);
    }
    send(response, 200, { data: charge });
    return true;
  }

  if (path === "/api/v1/admin/compliance/queue" && request.method === "GET") {
    if (!need("customs.manage")) return true;
    const items = Object.values(shop.shipments).filter((sh) => sh.complianceState?.status === "review_required").map((sh) => ({ ...shipRow(sh), findings: sh.complianceState.findings }));
    send(response, 200, paged(items));
    return true;
  }
  const invalid = (errors) => { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; };
  // ---- staff and roles
  const STAFF_KEYS = ["agent", "finance", "ops", "viewer", "officer", "accounts", "bookkeeper", "admin", "sysadmin"];
  const ROLE_DEFS = [
    { name: "super-admin", grants_everything: true, permissions: [] },
    { name: "system-admin", grants_everything: false, permissions: ["dashboard.view", "users.manage"] },
    { name: "operations-manager", grants_everything: false, permissions: ["shipments.assign", "shipments.view", "tracking.create"] },
    { name: "shipping-agent", grants_everything: false, permissions: ["shipments.view", "tracking.create"] },
    { name: "finance-officer", grants_everything: false, permissions: ["payments.view", "refunds.approve"] },
    { name: "customer-support-agent", grants_everything: false, permissions: ["claims.manage", "tickets.manage"] },
    { name: "compliance-officer", grants_everything: false, permissions: ["customs.manage"] },
  ];
  shop.staffMembers ??= STAFF_KEYS.map((key, n) => { const u = userFor(key); return { id: u.id, name: u.name, email: u.email, roles: u.roles, status: "active", two_factor_enabled: key !== "bookkeeper", suspended_at: null, created_at: new Date(Date.now() - (n + 5) * 86_400_000).toISOString() }; });
  const present = (m, detail = false) => ({ ...m, ...(detail ? { permissions: m.roles.includes("super-admin") ? ["everything.a", "everything.b"] : [...new Set(m.roles.flatMap((r) => ROLE_DEFS.find((d) => d.name === r)?.permissions ?? []))].sort() } : {}) });
  const isSuper = (u) => u.roles.includes("super-admin");

  if (path === "/api/v1/admin/roles" && request.method === "GET") {
    if (!need("users.manage")) return true;
    send(response, 200, { data: ROLE_DEFS });
    return true;
  }

  const staffRoute = path.match(/^\/api\/v1\/admin\/staff(?:\/([^/]+)(\/roles|\/suspend|\/reactivate|\/password-reset|\/two-factor\/reset)?)?$/);
  if (staffRoute) {
    if (!need("users.manage")) return true;
    const [, id, sub] = staffRoute;

    if (!id && request.method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = shop.staffMembers.filter((m) => (!url.searchParams.get("status") || m.status === url.searchParams.get("status")) && (!url.searchParams.get("role") || m.roles.includes(url.searchParams.get("role"))) && (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      shop.lastStaffQuery = Object.fromEntries(url.searchParams.entries());
      send(response, 200, paged(items.map((m) => present(m))));
      return true;
    }

    if (!id && request.method === "POST") {
      const errors = {};
      if (!body.name) errors.name = ["The name field is required."];
      if (!body.email || !/^[^\s@]+@[^\s@]+$/.test(body.email)) errors.email = ["The email field must be a valid email address."];
      if (!Array.isArray(body.roles) || body.roles.length === 0) errors.roles = ["The roles field is required."];
      if (Object.keys(errors).length) return invalid(errors);
      if (body.roles.includes("super-admin") && !isSuper(user)) { err(response, 403, "super_admin_only", "Only a super administrator can grant the super administrator role."); return true; }
      if (shop.staffMembers.some((m) => m.email === body.email)) { err(response, 409, "email_taken", "An account with this email already exists."); return true; }
      const created = { id: `NEW${shop.staffMembers.length + 1}${"0".repeat(20)}`.slice(0, 26), name: body.name, email: body.email, roles: body.roles, status: "active", two_factor_enabled: false, suspended_at: null, created_at: new Date().toISOString() };
      shop.staffMembers.push(created);
      shop.adminLog.push(`staff-invite:${created.email}:${created.roles.join("+")}`);
      send(response, 201, { data: present(created, true) });
      return true;
    }

    const target = shop.staffMembers.find((m) => m.id === id);
    if (!target) { err(response, 404, "not_found", "The requested resource was not found."); return true; }

    if (!sub && request.method === "GET") { send(response, 200, { data: present(target, true) }); return true; }

    const self = target.id === user.id;
    const lockedSuper = isSuper(target) && !isSuper(user);
    const activeSupers = () => shop.staffMembers.filter((m) => isSuper(m) && m.status === "active" && m !== target).length;

    if (sub === "/password-reset") {
      if (lockedSuper) { err(response, 403, "super_admin_only", "Only a super administrator can manage a super administrator."); return true; }
      shop.adminLog.push(`staff-reset-link:${target.email}`);
      send(response, 202, { data: { message: "A password reset link has been sent." } });
      return true;
    }
    if (self) { err(response, 403, "cannot_change_self", "You cannot change your own access. Ask another administrator."); return true; }
    if (lockedSuper) { err(response, 403, "super_admin_only", "Only a super administrator can manage a super administrator."); return true; }

    if (sub === "/roles" && request.method === "PUT") {
      if (!Array.isArray(body.roles) || body.roles.length === 0) return invalid({ roles: ["The roles field is required."] });
      if (body.roles.includes("super-admin") && !isSuper(user)) { err(response, 403, "super_admin_only", "Only a super administrator can grant the super administrator role."); return true; }
      if (isSuper(target) && !body.roles.includes("super-admin") && activeSupers() === 0) { err(response, 409, "last_super_admin", "There must always be at least one active super administrator."); return true; }
      shop.adminLog.push(`staff-roles:${target.email}:${target.roles.join("+")}=>${body.roles.join("+")}`);
      target.roles = body.roles;
      send(response, 200, { data: present(target, true) });
      return true;
    }
    if (sub === "/suspend") {
      if (isSuper(target) && activeSupers() === 0) { err(response, 409, "last_super_admin", "There must always be at least one active super administrator."); return true; }
      target.status = "suspended";
      target.suspended_at = new Date().toISOString();
      shop.adminLog.push(`staff-suspend:${target.email}`);
      send(response, 200, { data: present(target) });
      return true;
    }
    if (sub === "/reactivate") {
      target.status = "active";
      target.suspended_at = null;
      shop.adminLog.push(`staff-reactivate:${target.email}`);
      send(response, 200, { data: present(target) });
      return true;
    }
    if (sub === "/two-factor/reset") {
      target.two_factor_enabled = false;
      shop.adminLog.push(`staff-2fa-reset:${target.email}`);
      send(response, 200, { data: present(target) });
      return true;
    }
  }

  // ---- screening rules and document requirements
  shop.restrictions ??= [];
  shop.requirements ??= [];
  const KNOWN_COUNTRIES = ["NG", "DE", "US", "GB", "FR", "ZA", "KE", "GH"];

  if (path === "/api/v1/admin/item-restrictions" || path.match(/^\/api\/v1\/admin\/item-restrictions\/\d+$/)) {
    if (!need("customs.manage")) return true;
    const id = Number(path.split("/").pop());
    const rule = Number.isInteger(id) ? shop.restrictions.find((r) => r.id === id) : undefined;
    const present = (r) => ({ id: r.id, label: r.label, action: r.action, country_code: r.country_code ?? null, applies_to: r.applies_to ?? "any", keywords: r.keywords ?? [], hs_prefixes: r.hs_prefixes ?? [], reason: r.reason ?? null, is_active: r.is_active ?? true });
    const check = (data, existing) => {
      const errors = {};
      const merged = { ...existing, ...data };
      if (!existing && !data.label) errors.label = ["The label field is required."];
      if (data.country_code && !KNOWN_COUNTRIES.includes(data.country_code)) errors.country_code = ["The selected country code is invalid."];
      if ((data.keywords ?? []).some((k) => k.length < 2)) errors["keywords.0"] = ["The keywords.0 field must be at least 2 characters."];
      if ((data.hs_prefixes ?? []).some((p) => !/^\d{2,10}$/.test(p))) errors["hs_prefixes.0"] = ["The hs_prefixes.0 field format is invalid."];
      if (!(merged.keywords ?? []).length && !(merged.hs_prefixes ?? []).length) errors.keywords = ["Add at least one keyword or HS prefix, otherwise the rule can never match."];
      return errors;
    };

    if (request.method === "GET" && !rule && path.endsWith("item-restrictions")) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = shop.restrictions.filter((r) => (!url.searchParams.get("action") || r.action === url.searchParams.get("action")) && (url.searchParams.get("active") === null || url.searchParams.get("active") === "" || (url.searchParams.get("active") === "1") === (r.is_active ?? true))
        && (!url.searchParams.get("country") || r.country_code === url.searchParams.get("country").toUpperCase()) && (!q || r.label.toLowerCase().includes(q)))
        .sort((a, b) => (a.action === "prohibited" ? 0 : 1) - (b.action === "prohibited" ? 0 : 1) || a.label.localeCompare(b.label));
      shop.lastRestrictionQuery = Object.fromEntries(url.searchParams.entries());
      send(response, 200, paged(items.map(present)));
      return true;
    }
    if (request.method === "POST" && path.endsWith("item-restrictions")) {
      const errors = check(body, null);
      if (Object.keys(errors).length) return invalid(errors);
      const created = { id: (shop.restrictions.at(-1)?.id ?? 0) + 1, is_active: true, applies_to: "any", ...body };
      shop.restrictions.push(created);
      shop.adminLog.push(`rule-add:${created.label}:${created.action}`);
      send(response, 201, { data: present(created) });
      return true;
    }
    if (!rule) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (request.method === "PATCH") {
      const errors = check(body, rule);
      if (Object.keys(errors).length) return invalid(errors);
      Object.assign(rule, body);
      shop.adminLog.push(`rule-update:${rule.label}:${JSON.stringify(body)}`);
      send(response, 200, { data: present(rule) });
      return true;
    }
    if (request.method === "DELETE") {
      if (rule.inUse) { err(response, 409, "in_use", "This record is referenced by other data and cannot be deleted. Disable or archive it instead."); return true; }
      shop.restrictions = shop.restrictions.filter((r) => r !== rule);
      shop.adminLog.push(`rule-delete:${rule.label}`);
      response.writeHead(204, { "Access-Control-Allow-Origin": request.headers.origin ?? "*", "Access-Control-Allow-Credentials": "true" });
      response.end();
      return true;
    }
    send(response, 200, { data: present(rule) });
    return true;
  }

  if (path === "/api/v1/admin/customs-requirements" || path.match(/^\/api\/v1\/admin\/customs-requirements\/\d+$/)) {
    if (!need("customs.manage")) return true;
    const id = Number(path.split("/").pop());
    const req = Number.isInteger(id) ? shop.requirements.find((r) => r.id === id) : undefined;
    const present = (r) => ({ id: r.id, country_code: r.country_code, direction: r.direction, document_type: r.document_type, label: r.label, shipment_types: r.shipment_types ?? null, min_declared_value_minor: r.min_declared_value_minor ?? 0, value_currency: r.value_currency ?? "USD", is_mandatory: r.is_mandatory ?? true, requires_hs_code: r.requires_hs_code ?? false, notes: r.notes ?? null, is_active: r.is_active ?? true });

    if (request.method === "GET" && !req && path.endsWith("customs-requirements")) {
      const items = shop.requirements.filter((r) => (!url.searchParams.get("country") || r.country_code === url.searchParams.get("country").toUpperCase()) && (!url.searchParams.get("direction") || r.direction === url.searchParams.get("direction")))
        .sort((a, b) => a.country_code.localeCompare(b.country_code) || a.id - b.id);
      shop.lastRequirementQuery = Object.fromEntries(url.searchParams.entries());
      send(response, 200, paged(items.map(present)));
      return true;
    }
    if (request.method === "POST" && path.endsWith("customs-requirements")) {
      const errors = {};
      if (!body.country_code) errors.country_code = ["The country code field is required."];
      else if (!KNOWN_COUNTRIES.includes(body.country_code)) errors.country_code = ["The selected country code is invalid."];
      if (!body.label) errors.label = ["The label field is required."];
      if (Object.keys(errors).length) return invalid(errors);
      const created = { id: (shop.requirements.at(-1)?.id ?? 0) + 1, is_active: true, ...body };
      shop.requirements.push(created);
      shop.adminLog.push(`req-add:${created.country_code}:${created.direction}:${created.document_type}:${created.min_declared_value_minor ?? 0}:${created.value_currency}`);
      send(response, 201, { data: present(created) });
      return true;
    }
    if (!req) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (request.method === "PATCH") {
      Object.assign(req, body);
      shop.adminLog.push(`req-update:${req.country_code}:${JSON.stringify(body)}`);
      send(response, 200, { data: present(req) });
      return true;
    }
    if (request.method === "DELETE") {
      shop.requirements = shop.requirements.filter((r) => r !== req);
      shop.adminLog.push(`req-delete:${req.country_code}:${req.document_type}`);
      response.writeHead(204, { "Access-Control-Allow-Origin": request.headers.origin ?? "*", "Access-Control-Allow-Credentials": "true" });
      response.end();
      return true;
    }
    send(response, 200, { data: present(req) });
    return true;
  }

  // ---- finance
  shop.invoices ??= {};
  const DAY = 86_400_000;
  const allInvoices = () => [
    ...Object.values(shop.shipments).filter((sh) => sh.payment).map((sh) => ({ id: sh.payment.invoice_id, number: sh.payment.invoice_number, status: sh.payment.status === "refunded" ? "refunded" : sh.payment.status === "partially_refunded" ? "partially_refunded" : sh.payment.status === "paid" ? "paid" : "issued", kind: "prepaid", tracking_number: sh.tracking_number, shipment_id: sh.id, billing_name: "Ada Shipper", currency: "USD", total_minor: sh.total.amount_minor, refunded_minor: sh.refundedMinor ?? 0, issued_at: sh.created_at, due_at: null, paid_at: sh.payment.status !== "issued" ? sh.created_at : null, shipment: sh })),
    ...Object.values(shop.invoices),
  ];
  const invRow = (i) => ({ id: i.id, number: i.number, status: i.status, kind: i.kind, tracking_number: i.tracking_number, shipment_id: i.shipment_id, billing_name: i.billing_name, currency: i.currency, total_minor: i.total_minor, refunded_minor: i.refunded_minor, issued_at: i.issued_at, due_at: i.due_at, paid_at: i.paid_at, overdue: i.status === "issued" && i.due_at !== null && Date.parse(i.due_at) < Date.now() });

  if (path === "/api/v1/admin/finance/invoices" && request.method === "GET") {
    if (!need("payments.view")) return true;
    if (url.searchParams.has("overdue") && !["1", "0"].includes(url.searchParams.get("overdue"))) { err(response, 422, "validation_failed", "The given data was invalid.", { overdue: ["The overdue field must be true or false."] }); return true; }
    const q = (url.searchParams.get("q") ?? "").toUpperCase();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const items = allInvoices().map(invRow).filter((i) =>
      (!url.searchParams.get("status") || i.status === url.searchParams.get("status")) && (!url.searchParams.get("kind") || i.kind === url.searchParams.get("kind"))
      && (url.searchParams.get("overdue") !== "1" || i.overdue) && (!q || i.number.startsWith(q)) && (!from || i.issued_at.slice(0, 10) >= from) && (!to || i.issued_at.slice(0, 10) <= to));
    shop.lastInvoiceQuery = Object.fromEntries(url.searchParams.entries());
    send(response, 200, paged(items));
    return true;
  }

  const invoiceRoute = path.match(/^\/api\/v1\/admin\/finance\/invoices\/([^/]+)(\/payments)?$/);
  if (invoiceRoute) {
    if (!need("payments.view")) return true;
    const inv = allInvoices().find((i) => i.id === invoiceRoute[1]);
    if (!inv) { err(response, 404, "not_found", "The requested resource was not found."); return true; }

    if (invoiceRoute[2] === "/payments" && request.method === "POST") {
      if (!need("payments.record")) return true;
      const key = request.headers["idempotency-key"];
      if (!key) { err(response, 422, "idempotency_key_required", "An Idempotency-Key header (8–128 letters, digits or . _ : -) is required."); return true; }
      if (inv.kind !== "invoiced" || inv.status !== "issued") { err(response, 409, "payment_not_recordable", "Only unpaid invoices on account can have an offline payment recorded."); return true; }
      if (!body.reference) { err(response, 422, "validation_failed", "The given data was invalid.", { reference: ["The reference field is required."] }); return true; }
      inv.status = "paid";
      inv.paid_at = new Date().toISOString();
      inv.ledger = [...(inv.ledger ?? []), { type: "charge", amount_minor: inv.total_minor, reference: body.reference, metadata: { method: "offline" }, occurred_at: inv.paid_at }];
      shop.adminLog.push(`record-payment:${inv.number}:${body.reference}:${key}`);
      send(response, 200, { data: invRow(inv) });
      return true;
    }

    const fromShipment = inv.shipment;
    send(response, 200, { data: {
      ...invRow(inv),
      items: inv.items ?? [{ kind: "transport", description: "Transportation charge", amount_minor: Math.round(inv.total_minor * 0.8) }, { kind: "fuel", description: "Fuel surcharge", amount_minor: inv.total_minor - Math.round(inv.total_minor * 0.8) }],
      payment_attempts: inv.attempts ?? (fromShipment ? [{ id: `ATT-${inv.id}`, provider: "sandbox", reference: `sbx_${inv.number}`, status: "succeeded", failure_code: null, amount_minor: inv.total_minor, duplicate: false }] : []),
      ledger: inv.ledger ?? (fromShipment && inv.status !== "issued" ? [{ type: "charge", amount_minor: inv.total_minor, reference: `sbx_${inv.number}`, metadata: null, occurred_at: inv.paid_at }, ...(inv.refunded_minor > 0 ? [{ type: "refund", amount_minor: inv.refunded_minor, reference: "re_1", metadata: null, occurred_at: new Date().toISOString() }] : [])] : []),
      credit_notes: inv.refunded_minor > 0 ? [{ number: "CN-2026-000001", amount_minor: inv.refunded_minor }] : [],
    } });
    return true;
  }

  if (path === "/api/v1/admin/finance/payments" && request.method === "GET") {
    if (!need("payments.view")) return true;
    const rows = [
      ...allInvoices().filter((i) => i.shipment && i.status !== "issued").map((i) => ({ id: `ATT-${i.id}`, invoice: i.number, provider: "sandbox", reference: `sbx_${i.number}`, status: "succeeded", failure_code: null, amount_minor: i.total_minor, currency: "USD", duplicate: false, created_at: i.issued_at })),
      ...(shop.adminPayments ?? []),
    ].filter((p) => !url.searchParams.get("status") || p.status === url.searchParams.get("status"));
    send(response, 200, paged(rows));
    return true;
  }

  if (path === "/api/v1/admin/finance/reconciliation" && request.method === "GET") {
    if (!need("payments.view")) return true;
    const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const from = url.searchParams.get("from") ?? new Date(Date.parse(to) - 29 * DAY).toISOString().slice(0, 10);
    const overdue = allInvoices().map(invRow).filter((i) => i.kind === "invoiced" && i.overdue).map((i) => ({ number: i.number, currency_code: i.currency, total_minor: i.total_minor, due_at: i.due_at, days_overdue: Math.floor((Date.now() - Date.parse(i.due_at)) / DAY) }));
    const checks = {
      paid_invoice_without_matching_charges: { description: "Paid invoices whose recorded (non-duplicate) charges do not add up to the invoice total.", count: 0, rows: [] },
      duplicate_payments_to_refund: { description: "Money received twice for one invoice; the extra payment needs refunding.", count: 0, rows: [] },
      overdue_invoices: { description: "Invoices on account that are past their due date and unpaid.", count: overdue.length, rows: overdue },
      ...(shop.reconciliationExtra ?? {}),
    };
    shop.lastReconciliationQuery = { from, to };
    send(response, 200, { data: { range: { from, to }, summary: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.count])), checks } });
    return true;
  }

  if (path === "/api/v1/admin/finance/export/transactions" && request.method === "GET") {
    if (!need("invoices.manage") || !need("reports.export")) return true;
    if (!url.searchParams.get("from") || !url.searchParams.get("to")) { err(response, 422, "validation_failed", "The given data was invalid.", { from: ["The from field is required."] }); return true; }
    if (shop.exportTooBig) { err(response, 422, "http_error", "This export has 90000 rows; choose a shorter period."); return true; }
    shop.adminLog.push(`export:${url.searchParams.get("from")}:${url.searchParams.get("to")}`);
    response.writeHead(200, { "Content-Type": "text/csv; charset=UTF-8", "Content-Disposition": 'attachment; filename="ledger.csv"', "Access-Control-Allow-Origin": request.headers.origin ?? "*", "Access-Control-Allow-Credentials": "true" });
    response.end("occurred_at,invoice,type,currency,amount_minor,reference\n");
    return true;
  }

  err(response, 404, "not_found", "The requested resource was not found.");
  return true;
}

async function handleShop(request, response, path, url) {
  if (path === "/api/v1/public/countries") { send(response, 200, { data: COUNTRIES }); return true; }
  const isQuotes = path.startsWith("/api/v1/quotes");
  const isShipments = path.startsWith("/api/v1/shipments");
  const isSandbox = path.startsWith("/api/v1/sandbox/payments/");
  const isInvoices = path.startsWith("/api/v1/invoices");
  const isDocuments = path.startsWith("/api/v1/documents/");
  const isSupport = path.startsWith("/api/v1/support/") || path.startsWith("/api/v1/claims");
  if (!isQuotes && !isShipments && !isSandbox && !isInvoices && !isDocuments && !isSupport) return false;

  if (isDocuments) {
    response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="invoice.pdf"', "Access-Control-Allow-Origin": "*" });
    response.end("%PDF-1.4 stub invoice");

    return true;
  }

  const jar = cookies(request);
  const session = jar.stub_session || null;
  if (request.method !== "GET" && jar["XSRF-TOKEN"] !== request.headers["x-xsrf-token"]) { err(response, 419, "csrf_token_mismatch", "CSRF token mismatch."); return true; }
  const multipart = (request.headers["content-type"] ?? "").startsWith("multipart/form-data");
  const raw = multipart ? Buffer.concat(await (async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return chunks; })()) : null;
  const parsedForm = multipart ? parseMultipart(raw, request.headers["content-type"]) : null;
  const body = request.method === "GET" ? {} : multipart ? parsedForm.fields : await readJson(request);
  const sent = parsedForm?.files ?? [];
  const { shop } = state;
  shop.tickets ??= {};
  shop.claims ??= {};
  shop.attachmentCount ??= 0;
  const keepFiles = (files) => files.map((f) => {
    const id = `ATT${++shop.attachmentCount}`;
    const type = f.data.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : f.data[0] === 0x89 ? "image/png" : "image/jpeg";
    shop.lastAttachments = [...(shop.lastAttachments ?? []), { name: f.filename, bytes: f.data.length }];

    return { id, name: f.filename, size: f.data.length, type };
  });
  const countFiles = (items) => items.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);

  if (path === "/api/v1/quotes" && request.method === "POST") {
    const errors = {};
    if (!body.origin?.city) errors["origin.city"] = ["The origin.city field is required."];
    if (body.contents === "trigger-422") errors.contents = ["The contents field is not acceptable."];
    if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
    const id = `01QUOTE${String(Object.keys(shop.quotes).length + 1).padStart(6, "0")}`;
    shop.quotes[id] = makeQuote(body, id);
    shop.lastQuoteRequest = body;
    send(response, 201, { data: shop.quotes[id] });
    return true;
  }

  const quote = path.match(/^\/api\/v1\/quotes\/([^/]+)$/);
  if (quote && request.method === "GET") {
    if (quote[1] === "01EXPIREDQUOTE000000000") { send(response, 200, { data: { ...makeQuote({ origin: { country: "NG", city: "Lagos" }, destination: { country: "DE", city: "Berlin" }, shipment_type: "parcel", contents: "Old goods", packages: [{}] }, quote[1]), status: "expired" } }); return true; }
    if (shop.quotes[quote[1]]) send(response, 200, { data: shop.quotes[quote[1]] });
    else err(response, 404, "not_found", "The requested resource was not found.");

    return true;
  }

  if (path === "/api/v1/shipments" && request.method === "POST") {
    const key = request.headers["idempotency-key"];
    if (!key) { err(response, 422, "idempotency_key_required", "An Idempotency-Key header is required."); return true; }
    if (shop.idempotency[key]) return send(response, 201, { data: shop.idempotency[key] }, { "Idempotent-Replayed": "true" }), true;
    const q = shop.quotes[body.quote_id];
    if (!q) { err(response, 422, "validation_failed", "The given data was invalid.", { quote_id: ["The selected quote id is invalid."] }); return true; }
    const errors = {};
    partyRules(body, "sender", errors);
    partyRules(body, "recipient", errors);
    if (!session && !body.contact_email) errors.contact_email = ["A contact email is required."];
    if (body.terms_accepted !== true) errors.terms_accepted = ["The terms accepted field must be accepted."];
    const total = (body.items ?? []).reduce((sum, i) => sum + Math.round(Number(i.unit_value) * 100) * Number(i.quantity), 0);
    if (q.shipment.declared_value.amount_minor > 0 && total !== q.shipment.declared_value.amount_minor) errors.items = ["The total value of the items must equal the declared value used for the quote."];
    if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }

    shop.created += 1;
    const id = `01SHIP${String(shop.created).padStart(6, "0")}AAAAAA`;
    const chosen = q.options.find((o) => o.id === body.option_id) ?? q.options[0];
    const token = `guest-token-${id}`;
    const shipment = {
      id, tracking_number: `LG${String(shop.created).padStart(12, "0")}`, status: "booking_pending", status_label: "Booking pending", is_demo: chosen.service.is_demo,
      service: { slug: chosen.service.slug, name: chosen.service.name }, estimated_delivery: { min_days: 7, max_days: 13, unit: "days" }, total: chosen.totals.total,
      payment: { method: "prepaid", status: "issued", invoice_id: `01INV${id}`, invoice_number: `INV-2026-${String(shop.created).padStart(6, "0")}`, requires_payment: true, refunded: money(0) },
      cancellable: true, cancellation_reason: null, cancelled_at: null,
      sender: { company: null, email: null, line2: null, state: null, postal_code: null, ...body.sender }, recipient: { company: null, email: null, line2: null, state: null, postal_code: null, ...body.recipient },
      contents: q.shipment.contents, items: body.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_value_minor: Math.round(Number(i.unit_value) * 100), currency: "USD", hs_code: i.hs_code ?? null, origin_country: i.origin_country })),
      required_documents: ["Commercial invoice"], created_at: new Date().toISOString(),
      guestToken: session ? null : token, owner: session ?? null,
    };
    shop.shipments[id] = shipment;
    const result = { ...publicShipment(shipment), ...(shipment.guestToken ? { guest_access_token: shipment.guestToken } : {}) };
    shop.idempotency[key] = result;
    shop.lastBooking = body;
    send(response, 201, { data: result }, { "Idempotent-Replayed": "false" });
    return true;
  }

  // ---- support tickets
  const ticketView = (t) => ({ id: t.id, number: t.number, subject: t.subject, category: t.category, status: t.status, last_activity_at: t.last_activity_at });
  const ticketFull = (t) => ({ ...ticketView(t), tracking_number: t.tracking_number ?? null, messages: t.messages.filter((m) => !m.internal).map((m) => ({ ...m, attachments: m.attachments ?? [] })) });
  const ticketAllowed = (t) => t && ((t.owner && t.owner === session) || (t.token && request.headers["x-ticket-token"] === t.token));

  if (path === "/api/v1/support/tickets" && request.method === "POST") {
    const errors = {};
    if (!body.subject) errors.subject = ["The subject field is required."];
    if (!body.message) errors.message = ["The message field is required."];
    if (!["general", "shipment", "billing", "customs", "technical"].includes(body.category)) errors.category = ["The selected category is invalid."];
    if (!session && !body.email) errors.email = ["The email field is required."];
    let tracking = null;
    if (body.tracking_number) {
      const found = Object.values(shop.shipments).find((x) => x.tracking_number === String(body.tracking_number).toUpperCase());
      const ok = found && ((found.owner && found.owner === session) || (found.guestToken && request.headers["x-guest-token"] === found.guestToken));
      if (!ok) errors.tracking_number = ["We could not find that shipment on your account."];
      else tracking = found.tracking_number;
    }
    if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
    const problem = attachmentProblem(sent, 0);
    if (problem) { err(response, problem.status, problem.code, problem.message, problem.errors); return true; }
    const n = Object.keys(shop.tickets).length + 1;
    const ticket = {
      id: `T${n}`, number: `TKT-2026-${String(n).padStart(6, "0")}`, subject: body.subject, category: body.category, status: "open", last_activity_at: new Date().toISOString(), tracking_number: tracking,
      email: body.email ?? null, created_at: new Date().toISOString(), messages: [{ from: "customer", body: body.message, created_at: new Date().toISOString(), attachments: keepFiles(sent) }], owner: session, token: session ? null : `ticket-token-T${n}`,
    };
    shop.tickets[ticket.id] = ticket;
    shop.lastTicket = body;
    send(response, 201, { data: { ...ticketFull(ticket), ...(ticket.token ? { access_token: ticket.token } : {}) } });
    return true;
  }

  if (path === "/api/v1/support/tickets" && request.method === "GET") {
    if (!session) { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
    const mine = Object.values(shop.tickets).filter((t) => t.owner === session).reverse().map(ticketView);
    const size = shop.pageSize ?? 20;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    send(response, 200, { data: mine.slice((page - 1) * size, page * size), meta: { total: mine.length, last_page: Math.max(1, Math.ceil(mine.length / size)) } });
    return true;
  }

  const ticketRoute = path.match(/^\/api\/v1\/support\/tickets\/([^/]+)(\/messages|\/close|\/attachments\/[^/]+)?$/);
  if (ticketRoute) {
    const t = shop.tickets[ticketRoute[1]];
    if (!ticketAllowed(t)) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (ticketRoute[2]?.startsWith("/attachments/") && request.method === "GET") {
      const attId = ticketRoute[2].slice("/attachments/".length);
      const visible = t.messages.filter((m) => !m.internal).some((m) => m.attachments?.some((a) => a.id === attId));
      if (!visible) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      send(response, 200, { data: { url: `http://localhost:${PORT}/api/v1/documents/${attId}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });
      return true;
    }
    if (ticketRoute[2] === "/messages" && request.method === "POST") {
      if (t.status === "closed") { err(response, 409, "ticket_closed", "This ticket is closed. Please open a new one."); return true; }
      if (!body.message) { err(response, 422, "validation_failed", "The given data was invalid.", { message: ["The message field is required."] }); return true; }
      const problem = attachmentProblem(sent, countFiles(t.messages));
      if (problem) { err(response, problem.status, problem.code, problem.message, problem.errors); return true; }
      t.messages.push({ from: "customer", body: body.message, created_at: new Date().toISOString(), attachments: keepFiles(sent) });
      t.status = t.status === "resolved" ? "open" : t.status === "pending_customer" ? "pending_staff" : t.status;
      t.last_activity_at = new Date().toISOString();
      send(response, 201, { data: ticketFull(t) });
      return true;
    }
    if (ticketRoute[2] === "/close" && request.method === "POST") { t.status = "closed"; send(response, 200, { data: ticketView(t) }); return true; }
    send(response, 200, { data: ticketFull(t) });
    return true;
  }

  // ---- claims
  const claimView = (c, full = true) => ({
    id: c.id, number: c.number, status: c.status, type: c.type, tracking_number: c.tracking_number, description: c.description, incident_date: c.incident_date, claimed: c.claimed,
    approved: c.approved ?? null, paid: c.paid ?? null, resolution_note: ["approved", "rejected", "paid"].includes(c.status) ? c.resolution_note ?? null : null,
    attachments: c.attachments ?? [], notes: full ? c.notes.filter((n) => !n.internal).map((n) => ({ ...n, attachments: n.attachments ?? [] })) : null, created_at: c.created_at,
  });
  const claimAllowed = (c) => {
    if (!c) return false;
    const ship = shop.shipments[c.shipment_id];

    return (c.owner && c.owner === session) || Boolean(ship?.guestToken && request.headers["x-guest-token"] === ship.guestToken);
  };

  if (path === "/api/v1/claims" && request.method === "GET") {
    if (!session) { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
    const mine = Object.values(shop.claims).filter((c) => c.owner === session).reverse().map((c) => claimView(c, false));
    const size = shop.pageSize ?? 20;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    send(response, 200, { data: mine.slice((page - 1) * size, page * size), meta: { total: mine.length, last_page: Math.max(1, Math.ceil(mine.length / size)) } });
    return true;
  }

  const claimRoute = path.match(/^\/api\/v1\/claims\/([^/]+)(\/notes|\/withdraw|\/attachments\/[^/]+)?$/);
  if (claimRoute) {
    const c = shop.claims[claimRoute[1]];
    if (!claimAllowed(c)) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (claimRoute[2]?.startsWith("/attachments/") && request.method === "GET") {
      const attId = claimRoute[2].slice("/attachments/".length);
      const visible = (c.attachments ?? []).some((a) => a.id === attId) || c.notes.filter((n) => !n.internal).some((n) => n.attachments?.some((a) => a.id === attId));
      if (!visible) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      send(response, 200, { data: { url: `http://localhost:${PORT}/api/v1/documents/${attId}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });
      return true;
    }
    if (claimRoute[2] === "/withdraw" && request.method === "POST") {
      if (!["submitted", "under_review", "info_requested"].includes(c.status)) { err(response, 409, "claim_state", "Only a claim that has not been decided can be withdrawn."); return true; }
      c.status = "withdrawn";
      send(response, 200, { data: claimView(c) });
      return true;
    }
    if (claimRoute[2] === "/notes" && request.method === "POST") {
      if (["paid", "rejected", "closed", "withdrawn"].includes(c.status)) { err(response, 409, "conflict", "This claim is finished."); return true; }
      const problem = attachmentProblem(sent, countFiles(c.notes) + (c.attachments?.length ?? 0));
      if (problem) { err(response, problem.status, problem.code, problem.message, problem.errors); return true; }
      c.notes.push({ from: "customer", body: body.body, created_at: new Date().toISOString(), attachments: keepFiles(sent) });
      if (c.status === "info_requested") c.status = "under_review";
      send(response, 201, { data: claimView(c) });
      return true;
    }
    send(response, 200, { data: claimView(c) });
    return true;
  }

  if (path === "/api/v1/shipments" && request.method === "GET") {
    if (!session) { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
    const status = url.searchParams.get("status");
    const term = (url.searchParams.get("q") ?? "").replace(/[\s-]+/g, "").toUpperCase();
    const mine = Object.values(shop.shipments).filter((x) => x.owner === session)
      .filter((x) => (status === "active" ? !["delivered", "cancelled", "returned_to_sender"].includes(x.status) : status ? x.status === status : true))
      .filter((x) => x.tracking_number.startsWith(term)).reverse().map(publicShipment);
    send(response, 200, paginate(mine, request, url, shop.pageSize ?? 20));
    return true;
  }

  if (path === "/api/v1/invoices" && request.method === "GET") {
    if (!session) { err(response, 401, "unauthenticated", "Authentication is required."); return true; }
    const mine = Object.values(shop.shipments).filter((x) => x.owner === session).reverse().map(invoiceOf);
    send(response, 200, paginate(mine, request, url, shop.pageSize ?? 20));
    return true;
  }

  const invoicePdf = path.match(/^\/api\/v1\/invoices\/([^/]+)\/pdf$/);
  if (invoicePdf) {
    const owner = Object.values(shop.shipments).find((x) => x.payment.invoice_id === invoicePdf[1]);
    const allowed = owner && ((owner.guestToken && request.headers["x-guest-token"] === owner.guestToken) || (owner.owner && owner.owner === session));
    if (!allowed) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    send(response, 200, { data: { type: owner.payment.status === "paid" ? "receipt" : "invoice", url: `http://localhost:${PORT}/api/v1/documents/${owner.id}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });
    return true;
  }

  const shipmentMatch = path.match(/^\/api\/v1\/shipments\/([^/]+)(\/payments|\/cancel|\/claim-limits|\/claims|\/customs|\/customs-declaration|\/customs\/commercial-invoice|\/customs\/packing-list|\/documents|\/documents\/[^/]+)?$/);
  if (shipmentMatch) {
    const shipment = shop.shipments[shipmentMatch[1]];
    const staffReads = Boolean(userFor(session)?.permissions?.includes("shipments.view")) && request.method === "GET" && Boolean(shipmentMatch[2]?.startsWith("/documents/"));
    const allowed = shipment && ((shipment.guestToken && request.headers["x-guest-token"] === shipment.guestToken) || (shipment.owner && shipment.owner === session) || staffReads);
    if (!allowed) { err(response, 404, "not_found", "The requested resource was not found."); return true; }

    shipment.documents ??= [];
    const sub = shipmentMatch[2];
    const closed = ["delivered", "cancelled", "returned_to_sender"].includes(shipment.status);
    const link = (docId) => ({ data: { type: "document", url: `http://localhost:${PORT}/api/v1/documents/${docId}/download?signature=stub`, expires_at: new Date(Date.now() + 600000).toISOString() } });

    const claimEligibility = () => {
      const open = (type) => Object.values(shop.claims).some((c) => c.shipment_id === shipment.id && c.type === type && !["paid", "rejected", "closed", "withdrawn"].includes(c.status));
      const delivered = shipment.status === "delivered";
      const build = (type, reason) => ({ eligible: !reason && !open(type), reason: reason ?? (open(type) ? "There is already an open claim of this type for this shipment." : null) });

      return {
        loss: build("loss", delivered ? "A delivered shipment cannot be claimed as lost." : "A shipment can be claimed as lost 7 days after its promised delivery date."),
        damage: build("damage", delivered ? null : "Damage can be claimed once the shipment is delivered."),
        delay: build("delay", delivered ? "This shipment was delivered on time." : "This shipment is not late yet."),
        other: build("other", ["booking_pending", "booking_confirmed"].includes(shipment.status) ? "Claims can only be made once a shipment has been collected." : null),
      };
    };

    if (sub === "/claim-limits" && request.method === "GET") {
      send(response, 200, { data: { currency: "USD", cap_minor: shipment.total.amount_minor, insured: Boolean(shop.insured), cap: shipment.total, decimals: 2, window_days: 30, eligibility: claimEligibility() } });
      return true;
    }

    if (sub === "/claims" && request.method === "POST") {
      const errors = {};
      const eligibility = claimEligibility()[body.type];
      if (!["loss", "damage", "delay", "other"].includes(body.type)) errors.type = ["The selected type is invalid."];
      if (!/^\d{1,12}(\.\d{1,4})?$/.test(body.claimed_amount ?? "")) errors.claimed_amount = ["The claimed amount field format is invalid."];
      if ((body.description ?? "").length < 10) errors.description = ["The description field must be at least 10 characters."];
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      if (eligibility && !eligibility.eligible) { err(response, eligibility.reason?.startsWith("There is already") ? 409 : 422, eligibility.reason?.startsWith("There is already") ? "claim_exists" : "claim_not_eligible", eligibility.reason); return true; }
      const fileProblem = attachmentProblem(sent, 0);
      if (fileProblem) { err(response, fileProblem.status, fileProblem.code, fileProblem.message, fileProblem.errors); return true; }
      const minor = Math.round(Number(body.claimed_amount) * 100);
      if (minor < 1 || minor > shipment.total.amount_minor) { err(response, 422, "validation_failed", "The given data was invalid.", { claimed_amount: [`The amount must be more than 0 and at most ${shipment.total.amount} USD, the most this shipment is covered for because it was not insured.`] }); return true; }
      const n = Object.keys(shop.claims).length + 1;
      const claim = {
        id: `C${n}`, number: `CLM-2026-${String(n).padStart(6, "0")}`, status: "submitted", type: body.type, tracking_number: shipment.tracking_number, description: body.description, incident_date: body.incident_date,
        claimed: money(minor), approved: null, paid: null, resolution_note: null, notes: [], attachments: keepFiles(sent), created_at: new Date().toISOString(), owner: session, shipment_id: shipment.id,
      };
      shop.claims[claim.id] = claim;
      shop.lastClaim = body;
      send(response, 201, { data: claimView(claim) });
      return true;
    }

    if (sub === "/customs" && request.method === "GET") { send(response, 200, { data: customsOverview(shipment) }); return true; }

    if (sub === "/customs-declaration" && request.method === "PUT") {
      const errors = {};
      if (!INCOTERMS.includes(body.incoterm)) errors.incoterm = ["The selected incoterm is invalid."];
      if (!["sale", "gift", "sample", "return", "repair", "personal", "other"].includes(body.reason_for_export)) errors.reason_for_export = ["The selected reason for export is invalid."];
      if (body.eori_number && !/^[A-Z]{2}[A-Z0-9]{1,15}$/.test(body.eori_number)) errors.eori_number = ["The eori number field format is invalid."];
      if (shipment.sender?.country === shipment.recipient?.country) { err(response, 422, "not_international", "Customs declarations are only for shipments that cross a border."); return true; }
      if (closed) { err(response, 409, "shipment_closed", "This shipment is finished and its declaration can no longer change."); return true; }
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      shipment.declaration = { incoterm: body.incoterm, reason_for_export: body.reason_for_export, exporter_tax_id: body.exporter_tax_id ?? null, consignee_tax_id: body.consignee_tax_id ?? null, eori_number: body.eori_number ?? null, remarks: body.remarks ?? null };
      send(response, 200, { data: customsOverview(shipment) });
      return true;
    }

    if ((sub === "/customs/commercial-invoice" || sub === "/customs/packing-list") && request.method === "GET") {
      if (!shipment.declaration) { err(response, 422, "declaration_required", "Save the customs declaration first."); return true; }
      const type = sub.endsWith("invoice") ? "commercial_invoice" : "packing_list";
      shipment.documents = shipment.documents.filter((d) => !(d.generated && d.type === type));
      const doc = { id: `DOC${type}${shipment.id}`, type, name: `${type.replace("_", "-")}-${shipment.tracking_number}.pdf`, size: 9000, generated: true, uploaded_at: new Date().toISOString() };
      shipment.documents.push(doc);
      send(response, 200, link(doc.id));
      return true;
    }

    if (sub === "/documents" && request.method === "POST") {
      const { fields, file } = parseMultipart(raw, request.headers["content-type"]);
      const errors = {};
      if (!DOC_TYPES.includes(fields.type)) errors.type = ["The selected type is invalid."];
      if (!file) errors.file = ["The file field is required."];
      if (Object.keys(errors).length) { err(response, 422, "validation_failed", "The given data was invalid.", errors); return true; }
      if (shipment.documents.filter((d) => !d.generated).length >= (shop.documentLimit ?? 20)) { err(response, 422, "too_many_documents", "A shipment can have at most 20 uploaded documents."); return true; }
      if (!looksLikeAllowedFile(file.data)) { err(response, 422, "unsupported_media_type", "Only PDF, JPEG and PNG documents are accepted."); return true; }
      const doc = { id: `UPL${shipment.documents.length + 1}${shipment.id}`, type: fields.type, name: file.filename, size: file.data.length, generated: false, uploaded_at: new Date().toISOString() };
      shipment.documents.push(doc);
      shop.lastUpload = { type: fields.type, filename: file.filename, bytes: file.data.length };
      send(response, 201, { data: { id: doc.id, type: doc.type, name: doc.name, size: doc.size } });
      return true;
    }

    if (sub?.startsWith("/documents/") && request.method === "DELETE") {
      const doc = shipment.documents.find((d) => d.id === sub.slice("/documents/".length));
      if (!doc) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      if (doc.generated) { err(response, 409, "document_locked", "Documents we generated for you cannot be removed."); return true; }
      if (!BEFORE_CUSTOMS.includes(shipment.status)) { err(response, 409, "document_locked", "This shipment is already with customs, so its documents can no longer be removed. Contact support if one is wrong."); return true; }
      shipment.documents = shipment.documents.filter((d) => d !== doc);
      shop.removedDocuments = [...(shop.removedDocuments ?? []), doc.name];
      send(response, 200, { data: { removed: true } });
      return true;
    }

    if (sub?.startsWith("/documents/") && request.method === "GET") {
      const doc = shipment.documents.find((d) => d.id === sub.slice("/documents/".length));
      if (!doc) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
      send(response, 200, link(doc.id));
      return true;
    }

    if (shipmentMatch[2] === "/cancel" && request.method === "POST") {
      if (!shipment.cancellable) { err(response, 409, "shipment_collected", "This shipment has already been collected and can no longer be cancelled here."); return true; }
      const wasPaid = shipment.payment.status === "paid";
      shipment.status = "cancelled";
      shipment.status_label = "Cancelled";
      shipment.cancellable = false;
      shipment.cancelled_at = new Date().toISOString();
      shipment.cancellation_reason = body.reason ?? null;
      shipment.payment = { ...shipment.payment, requires_payment: false, status: wasPaid ? "paid" : "void", refunded: wasPaid ? shipment.total : money(0) };
      shipment.pendingPolls = 0;
      send(response, 200, { data: publicShipment(shipment) });
      return true;
    }

    if (shipmentMatch[2] === "/payments" && request.method === "POST") {
      if (shop.paymentDown) { err(response, 500, "server_error", "An unexpected error occurred."); return true; }
      if (!request.headers["idempotency-key"]) { err(response, 422, "idempotency_key_required", "An Idempotency-Key header is required."); return true; }
      const reference = `sbx_${shipment.id.toLowerCase()}`;
      shop.payments[reference] = shipment.id;
      send(response, 201, { data: { id: `01PAY${shipment.id}`, status: "requires_action", provider: "sandbox", amount_minor: shipment.total.amount_minor, currency: "USD", action: { type: "redirect", url: `${request.headers.origin ?? "http://localhost:3100"}/sandbox-pay?reference=${reference}`, sandbox: true } } });
      return true;
    }

    if (shipment.pendingPolls > 0) { shipment.pendingPolls -= 1; if (shipment.pendingPolls === 0) { shipment.payment = { ...shipment.payment, status: "paid", requires_payment: false }; if (shipment.status === "booking_pending") { shipment.status = "booking_confirmed"; shipment.status_label = "Booking confirmed"; } } }
    send(response, 200, { data: publicShipment(shipment) });
    return true;
  }

  const sandbox = path.match(/^\/api\/v1\/sandbox\/payments\/([^/]+)\/simulate$/);
  if (sandbox) {
    if (shop.sandboxOff) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    const shipment = shop.shipments[shop.payments[sandbox[1]]];
    if (!shipment) { err(response, 404, "not_found", "The requested resource was not found."); return true; }
    if (body.outcome === "succeeded") shipment.pendingPolls = shop.confirmDelay + 1;
    send(response, 200, { data: { handled: true } });
    return true;
  }

  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  currentOrigin = request.headers.origin ?? "*";
  if (request.method === "OPTIONS") return send(response, 204, null, { "Access-Control-Allow-Headers": "Accept, Content-Type, X-XSRF-TOKEN, Idempotency-Key, X-Guest-Token, X-Ticket-Token", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" });
  if (path === "/__health") return send(response, 200, { ok: true });
  if (path === "/__reset" && request.method === "POST") { state = initialState(); return send(response, 200, state); }
  if (path === "/__state" && request.method === "POST") { state = { ...state, ...(await readJson(request)) }; return send(response, 200, state); }

  if (!state.fail && await handleAuth(request, response, path)) return;
  if (!state.fail && await handleAdmin(request, response, path, url)) return;
  if (!state.fail && await handleShop(request, response, path, url)) return;

  if (state.fail && path.startsWith("/api/")) return send(response, 500, { error: { code: "server_error" } });

  if (path === "/api/v1/public/currencies") return send(response, 200, { data: [{ code: "EUR", name: "Euro", symbol: "€", minor_units: 2 }, { code: "NGN", name: "Nigerian Naira", symbol: "₦", minor_units: 2 }, { code: "USD", name: "US Dollar", symbol: "$", minor_units: 2 }] });
  if (path === "/__seed" && request.method === "POST") {
    const input = await readJson(request);
    for (const item of input.shipments ?? []) {
      state.shop.created += 1;
      const n = state.shop.created;
      const id = `01SEED${String(n).padStart(6, "0")}AAAAAA`;
      const paid = item.paid !== false;
      state.shop.shipments[id] = {
        id, tracking_number: item.tracking ?? `LG${String(n).padStart(12, "0")}`, status: item.status ?? "booking_confirmed", status_label: item.label ?? "Booking confirmed", is_demo: true,
        service: { slug: "international-economy", name: "International Economy" }, estimated_delivery: { min_days: 7, max_days: 13, unit: "days" }, total: money(item.total ?? 7041),
        payment: { method: "prepaid", status: paid ? "paid" : "issued", invoice_id: `01INV${id}`, invoice_number: `INV-2026-9${String(n).padStart(5, "0")}`, requires_payment: !paid, refunded: money(0) },
        sender: { name: "Ife Okoro", company: null, email: null, phone: "+2348012345678", line1: "1 Marina Road", line2: null, city: "Lagos", state: null, postal_code: null, country: "NG" },
        recipient: { name: "Hans Becker", company: null, email: null, phone: "+4915112345678", line1: "2 Unter den Linden", line2: null, city: item.domestic ? "Abuja" : "Berlin", state: null, postal_code: item.domestic ? null : "10115", country: item.domestic ? "NG" : "DE" },
        contents: "Clothing", items: [{ description: "Cotton shirts", quantity: 2, unit_value_minor: 5000, currency: "USD", hs_code: null, origin_country: "NG" }], required_documents: [],
        cancellable: item.cancellable ?? true, cancellation_reason: null, cancelled_at: null, created_at: new Date().toISOString(), guestToken: null, owner: "ada",
        documents: item.documents ?? [], complianceState: item.compliance ? { note: null, reviewed_at: null, ...item.compliance } : undefined, delayed: Boolean(item.delayed), guestEmail: item.customerEmail, compliance: item.compliance, charges: item.charges, declaration: item.declaration,
      };
    }
    return send(response, 200, { created: state.shop.created }), true;
  }
  if (path === "/__shipment-status" && request.method === "POST") {
    const input = await readJson(request);
    const target = Object.values(state.shop.shipments).find((x) => x.id === input.id || x.tracking_number === input.tracking);
    if (target) { target.status = input.status; target.status_label = input.label ?? input.status; target.cancellable = input.cancellable ?? false; }
    return send(response, 200, { ok: Boolean(target) }), true;
  }
  if (path === "/__ticket" && request.method === "POST") {
    const input = await readJson(request);
    const t = state.shop.tickets?.[input.id];
    if (t) {
      if (input.staffReply) t.messages.push({ from: "staff", body: input.staffReply, created_at: new Date().toISOString(), attachments: (input.files ?? []).map((name, i) => ({ id: `STF${t.messages.length}${i}`, name, size: 4096, type: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" })) });
      if (input.internalNote) t.messages.push({ from: "staff", body: input.internalNote, internal: true, created_at: new Date().toISOString(), attachments: [{ id: "SECRETFILE", name: "internal-only.pdf", size: 1, type: "application/pdf" }] });
      if (input.status) t.status = input.status;
    }
    return send(response, 200, { ok: Boolean(t) }), true;
  }
  if (path === "/__claim" && request.method === "POST") {
    const input = await readJson(request);
    const c = state.shop.claims?.[input.id];
    if (c) {
      if (input.status) c.status = input.status;
      if (input.staffNote) c.notes.push({ from: "staff", body: input.staffNote, created_at: new Date().toISOString(), attachments: (input.files ?? []).map((name, i) => ({ id: `STC${c.notes.length}${i}`, name, size: 4096, type: "application/pdf" })) });
      if (input.resolution_note) c.resolution_note = input.resolution_note;
      if (input.approved_minor) c.approved = money(input.approved_minor);
    }
    return send(response, 200, { ok: Boolean(c) }), true;
  }
  if (path === "/__admin-seed" && request.method === "POST") {
    const input = await readJson(request);
    state.shop.tickets ??= {};
    state.shop.claims ??= {};
    state.shop.restrictions ??= [];
    state.shop.requirements ??= [];
    for (const r of input.restrictions ?? []) state.shop.restrictions.push({ id: (state.shop.restrictions.at(-1)?.id ?? 0) + 1, is_active: true, applies_to: "any", keywords: [], hs_prefixes: [], ...r });
    for (const r of input.requirements ?? []) state.shop.requirements.push({ id: (state.shop.requirements.at(-1)?.id ?? 0) + 1, is_active: true, is_mandatory: true, ...r });
    for (const t of input.tickets ?? []) {
      const n = Object.keys(state.shop.tickets).length + 1;
      const now = new Date().toISOString();
      state.shop.tickets[`T${n}`] = { id: `T${n}`, number: `TKT-2026-${String(n).padStart(6, "0")}`, subject: "Seeded", category: "general", status: "open", created_at: now, last_activity_at: now, messages: [{ from: "customer", body: "Seeded message", created_at: now, attachments: [] }], owner: null, token: `ticket-token-T${n}`, ...t };
    }
    for (const c of input.claims ?? []) {
      const n = Object.keys(state.shop.claims).length + 1;
      state.shop.claims[`C${n}`] = { id: `C${n}`, number: `CLM-2026-${String(n).padStart(6, "0")}`, status: "submitted", type: "damage", tracking_number: "LG000000000001", description: "Seeded claim", incident_date: "2026-10-15", claimed: money(c.claimed_minor ?? 2000), approved: null, paid: null, notes: [], attachments: [], created_at: new Date().toISOString(), owner: null, shipment_id: null, ...c, ...(c.claimed_minor ? { claimed: money(c.claimed_minor) } : {}) };
    }
    return send(response, 200, { ok: true }), true;
  }
  if (path === "/__finance-seed" && request.method === "POST") {
    const input = await readJson(request);
    state.shop.invoices ??= {};
    for (const i of input.invoices ?? []) {
      const n = Object.keys(state.shop.invoices).length + 1;
      const issued = new Date(Date.now() - (i.issuedDaysAgo ?? 3) * 86_400_000).toISOString();
      state.shop.invoices[`INV${n}`] = { id: `INV${n}`, number: `INV-2026-8${String(n).padStart(5, "0")}`, status: "issued", kind: "invoiced", tracking_number: null, shipment_id: null, billing_name: "Acme Ltd", currency: "USD", total_minor: 150000, refunded_minor: 0, issued_at: issued, due_at: new Date(Date.now() + (i.dueInDays ?? 14) * 86_400_000).toISOString(), paid_at: null, ...i, issuedDaysAgo: undefined, dueInDays: undefined };
    }
    state.shop.adminPayments = [...(state.shop.adminPayments ?? []), ...(input.payments ?? [])];
    if (input.reconciliationExtra) state.shop.reconciliationExtra = input.reconciliationExtra;
    if (input.exportTooBig) state.shop.exportTooBig = true;
    return send(response, 200, { ok: true }), true;
  }
  if (path === "/__admin") return send(response, 200, { log: state.shop.adminLog ?? [], ticketQuery: state.shop.lastAdminTicketQuery ?? null, shipmentQuery: state.shop.lastAdminShipmentQuery ?? null, invoiceQuery: state.shop.lastInvoiceQuery ?? null, restrictionQuery: state.shop.lastRestrictionQuery ?? null, staffQuery: state.shop.lastStaffQuery ?? null, requirementQuery: state.shop.lastRequirementQuery ?? null, reconciliationQuery: state.shop.lastReconciliationQuery ?? null }), true;
  if (path === "/__shop") return send(response, 200, { quoteRequest: state.shop.lastQuoteRequest ?? null, booking: state.shop.lastBooking ?? null, created: state.shop.created, lastUpload: state.shop.lastUpload ?? null, lastTicket: state.shop.lastTicket ?? null, lastClaim: state.shop.lastClaim ?? null, removedDocuments: state.shop.removedDocuments ?? [], lastTrackingUpdate: state.shop.lastTrackingUpdate ?? null, attachments: state.shop.lastAttachments ?? [] }), true;
  if (path === "/__last-patch") return send(response, 200, { patch: state.auth.lastPatch ?? null });

  const tracking = path.match(/^\/api\/v1\/public\/tracking\/([^/]+)$/);
  if (tracking) {
    const number = decodeURIComponent(tracking[1]);
    if (state.trackingDown) return send(response, 503, { error: { code: "service_unavailable" } });
    if (number === "LG000000000429") return send(response, 429, { error: { code: "too_many_requests" } }, { "Retry-After": "45" });
    if (number === "LG000000000002") return send(response, 200, { data: trackingFixture(number, { status: { code: "delivered", label: "Delivered" }, is_demo: false, notice: null, estimated_delivery: null, delivered_at: "2026-10-18T12:00:00+00:00", timeline: [event("d1", "delivered", "Delivered", { delivered_to: "H. B." })] }) });

    return /^LG\d{12}$/.test(number) && number !== "LG000000000404" ? send(response, 200, { data: trackingFixture(number) }) : send(response, 404, { error: { code: "not_found" } });
  }

  if (path === "/api/v1/public/settings") return send(response, 200, { data: settings() });

  const menu = path.match(/^\/api\/v1\/public\/menus\/([a-z0-9-]+)$/);
  if (menu) return menus[menu[1]] ? send(response, 200, { data: menus[menu[1]] }) : send(response, 404, { error: { code: "not_found" } });

  const preview = path.match(/^\/api\/v1\/public\/preview\/([^/]+)$/);
  if (preview) {
    return url.searchParams.get("signature") === "valid" ? send(response, 200, { data: draft }) : send(response, 403, { error: { code: "forbidden" } });
  }

  const page = path.match(/^\/api\/v1\/public\/pages\/(.+)$/);
  if (page) {
    const slug = decodeURIComponent(page[1]);
    if (slug === "old-name") return send(response, 200, { data: null, redirect: { to: "/about-us", status: 301 } });
    const found = pages()[slug];

    return found ? send(response, 200, { data: found, redirect: null }) : send(response, 404, { error: { code: "not_found" } });
  }

  return send(response, 404, { error: { code: "not_found" } });
}).listen(PORT, () => console.log(`stub API listening on ${PORT}`));
