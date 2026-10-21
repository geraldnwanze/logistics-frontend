import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms, setCmsState } from "./support/cms";

const PASSWORD = "Str0ng-Passphrase-1";

test.beforeEach(async ({ request }) => resetCms(request));

const shopDefaults = { quotes: {}, shipments: {}, idempotency: {}, created: 0, payments: {}, sandboxOff: false, paymentDown: false, confirmDelay: 0 };
const setPageSize = (request: APIRequestContext, pageSize: number) => setCmsState(request, { shop: { ...shopDefaults, pageSize } });
const seed = (request: APIRequestContext, shipments: Record<string, unknown>[]) => request.post(`${STUB_URL}/__seed`, { data: { shipments } });

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?=&]/g, "\\$&") + "$"));
}

const MIX = [
  { tracking: "LG000000000101", status: "booking_confirmed", label: "Booking confirmed" },
  { tracking: "LG000000000102", status: "delivered", label: "Delivered", cancellable: false },
  { tracking: "LG000000000103", status: "in_transit", label: "In transit", cancellable: false },
  { tracking: "LG000000000104", status: "booking_pending", label: "Booking pending", paid: false },
  { tracking: "LG000000000105", status: "delivered", label: "Delivered", cancellable: false },
];

test("signed-out visitors are sent to sign in and straight back to the shipments and invoices pages", async ({ page }) => {
  await page.goto("/account/shipments");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fshipments$/);

  await page.goto("/account/invoices");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Finvoices$/);
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/invoices$/);
  await expect(page.getByText("No invoices yet.")).toBeVisible();
});

test("a new customer sees an invitation to book rather than an empty table", async ({ page }) => {
  await signIn(page, "/account/shipments");

  await expect(page.getByText("You haven't booked a shipment yet.")).toBeVisible();
  await page.getByRole("link", { name: "Get a quote" }).click();
  await expect(page).toHaveURL(/\/quote$/);
});

test("lists shipments newest first, with status, route and what's owed", async ({ page, request }) => {
  await seed(request, MIX);
  await signIn(page, "/account/shipments");

  const rows = page.locator("main ul > li").filter({ has: page.getByRole("link", { name: /^LG0000000001/ }) });
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("LG000000000105");
  await expect(rows.last()).toContainText("LG000000000101");
  const unpaid = rows.filter({ hasText: "LG000000000104" });
  await expect(unpaid).toContainText("Payment needed");
  await expect(unpaid).toContainText("Lagos, NG → Berlin, DE");
  await expect(page.getByText("5 shipments")).toBeVisible();
});

test("pages through a long list and keeps the place on reload", async ({ page, request }) => {
  await setPageSize(request, 2);
  await seed(request, MIX);
  await signIn(page, "/account/shipments");

  await expect(page.getByText("Page 1 of 3")).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous" })).toHaveCount(0);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/account\/shipments\?page=2$/);
  await expect(page.getByRole("link", { name: "LG000000000103" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Page 2 of 3")).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page 3 of 3")).toBeVisible();
  await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page.getByText("Page 2 of 3")).toBeVisible();
});

test("filters by progress and searches by tracking number, and says when nothing matches", async ({ page, request }) => {
  await seed(request, MIX);
  await signIn(page, "/account/shipments");

  await page.getByRole("navigation", { name: "Filter shipments" }).getByRole("link", { name: "Delivered" }).click();
  await expect(page).toHaveURL(/status=delivered$/);
  await expect(page.getByText("2 shipments")).toBeVisible();
  await expect(page.getByRole("link", { name: "LG000000000101" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Filter shipments" }).getByRole("link", { name: "In progress" }).click();
  await expect(page.getByText("3 shipments")).toBeVisible();

  await page.getByLabel("Search by tracking number").fill("lg-00000000010 3".replace(" ", ""));
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/status=active&q=lg-000000000103$/i);
  await expect(page.getByText("1 shipment", { exact: true })).toBeVisible();

  await page.getByLabel("Search by tracking number").fill("ZZZ");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No shipments match.")).toBeVisible();
  await page.getByRole("link", { name: "Show all shipments" }).click();
  await expect(page.getByText("5 shipments")).toBeVisible();
});

test("cancelling a paid booking explains the refund first, then shows the refund and the credit note", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000201", status: "booking_confirmed", label: "Booking confirmed" }]);
  await signIn(page, "/account/shipments");
  await page.getByRole("link", { name: "LG000000000201" }).click();

  await expect(page.getByRole("button", { name: "Cancel this booking" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByText(/refunded in full to your original payment method/)).toBeVisible();
  await page.getByRole("button", { name: "Keep my booking" }).click();
  await expect(page.getByText("Booking confirmed").first()).toBeVisible();

  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.getByLabel("Reason (optional)").fill("Changed my mind");
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();

  await expect(page.getByText(/This booking was cancelled/)).toBeVisible();
  await expect(page.getByText("Reason: Changed my mind")).toBeVisible();
  await expect(page.getByText(/Refunded: .*70\.41/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel this booking" })).toHaveCount(0);

  await page.goto("/account/invoices");
  const invoice = page.locator("main ul > li").first();
  await expect(invoice).toContainText("Refunded");
  await invoice.getByText("Details").click();
  await expect(invoice.getByText(/Credit note CN-/)).toBeVisible();

  await page.goto("/account/shipments?status=cancelled");
  await expect(page.getByRole("link", { name: "LG000000000201" })).toBeVisible();
});

test("cancelling before paying says nothing was charged and voids the invoice", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000301", status: "booking_pending", label: "Booking pending", paid: false }]);
  await signIn(page, "/account/shipments");
  await page.getByRole("link", { name: "LG000000000301" }).click();

  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByText(/haven't paid yet, so nothing will be charged/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();

  await expect(page.getByText("You were not charged.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
  await page.goto("/account/invoices");
  await expect(page.locator("main ul > li").first()).toContainText("Cancelled");
});

test("a shipment that has been collected offers no cancellation", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000401", status: "in_transit", label: "In transit", cancellable: false }]);
  await signIn(page, "/account/shipments");
  await page.getByRole("link", { name: "LG000000000401" }).click();

  await expect(page.locator("#tracking-heading")).toHaveText("LG000000000401");
  await expect(page.getByRole("button", { name: "Cancel this booking" })).toHaveCount(0);
});

test("downloads a receipt for a paid shipment and an invoice for an unpaid one", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000501", status: "booking_confirmed", label: "Booking confirmed" }, { tracking: "LG000000000502", status: "booking_pending", label: "Booking pending", paid: false }]);
  await signIn(page, "/account/invoices");

  const buttons = page.getByRole("button", { name: /Download/ });
  await expect(buttons).toHaveText(["Download invoice (PDF)", "Download receipt (PDF)"]);   // newest first: the unpaid one

  const [download] = await Promise.all([page.waitForEvent("download"), buttons.nth(1).click()]);
  expect(download.suggestedFilename()).toBe("invoice.pdf");
  expect((await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).startsWith("%PDF")).toBe(true);
  await expect(page).toHaveURL(/\/account\/invoices$/);   // the page stays put
});

test("the shipment page offers the same download", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000601", status: "booking_confirmed", label: "Booking confirmed" }]);
  await signIn(page, "/account/shipments");
  await page.getByRole("link", { name: "LG000000000601" }).click();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download receipt (PDF)" }).click()]);
  expect(download.suggestedFilename()).toBe("invoice.pdf");
});

test("these pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await seed(request, MIX);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await signIn(page, "/account/shipments");
  await page.goto("/account/invoices");
  await expect(page.getByRole("button", { name: /Download/ }).first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/account/shipments");
  await expect(page.getByRole("link", { name: "LG000000000105" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(overflow).toBeLessThanOrEqual(1);
  expect(cached.filter((path) => path.startsWith("/account"))).toEqual([]);
  expect(violations).toEqual([]);
});
