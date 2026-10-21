import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { post, seed, signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();
const financeSeed = (request: APIRequestContext, data: Record<string, unknown>) => post(request, "/__finance-seed", data);

const ACCOUNT_INVOICES = [
  { billing_name: "Acme Ltd", total_minor: 150000, dueInDays: -9, issuedDaysAgo: 30 },        // overdue
  { billing_name: "Globex", total_minor: 42000, dueInDays: 10, issuedDaysAgo: 4 },              // not due yet
  { billing_name: "Initech", total_minor: 9900, status: "paid", paid_at: new Date().toISOString(), due_at: null, issuedDaysAgo: 20 },
];

test.describe("invoices", () => {
  test("accounts see what is overdue, narrow the list, and the filters live in the address", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000901", status: "in_transit", label: "In transit", total: 7041 }]);
    await financeSeed(request, { invoices: ACCOUNT_INVOICES });
    await signIn(page, "/admin", "accounts@example.test");

    await expect(page.getByRole("link", { name: /Overdue invoices/ })).toContainText("1");
    await page.getByRole("link", { name: /Overdue invoices/ }).click();
    await expect(page).toHaveURL(/\/admin\/finance\/invoices\?overdue=1$/);
    await expect(page.getByText("1 invoice", { exact: true })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Acme Ltd" });
    await expect(row).toContainText("$1,500.00");
    await expect(row).toContainText("Overdue");
    await expect(row).toContainText("On account");

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByText("4 invoices", { exact: true })).toBeVisible();
    await page.getByLabel("Type").selectOption("prepaid");
    await expect(page).toHaveURL(/kind=prepaid$/);
    await expect(page.getByText("1 invoice", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "LG000000000901" })).toContainText("Paid online");
    expect((await adminState(request)).invoiceQuery).toMatchObject({ kind: "prepaid" });

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByLabel("Invoice number").fill("INV-2026-8");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=INV-2026-8$/);
    await expect(page.getByText("3 invoices", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Invoice number")).toHaveValue("INV-2026-8");
  });

  test("accounts record a bank transfer against an invoice on account, after confirming, and it becomes paid", async ({ page, request }) => {
    await financeSeed(request, { invoices: [ACCOUNT_INVOICES[0]] });
    await signIn(page, "/admin/finance/invoices", "accounts@example.test");
    await page.getByRole("link", { name: /INV-2026-8/ }).click();

    await expect(page.getByRole("heading", { name: /INV-2026-8/ })).toBeVisible();
    await expect(page.getByText("No money has moved on this invoice.")).toBeVisible();
    const panel = page.getByRole("region", { name: "Record a payment" });
    await expect(panel.getByRole("button", { name: "Review payment" })).toBeDisabled();
    await panel.getByLabel("Payment reference").fill("BANK-778");
    await panel.getByRole("button", { name: "Review payment" }).click();
    await expect(page.getByRole("group", { name: "Confirm payment" })).toContainText("Record $1,500.00 received as “BANK-778”?");
    await page.getByRole("button", { name: "Go back" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("record-payment"))).toEqual([]);
    await panel.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: "Yes, record it" }).click();

    await expect(page.getByRole("region", { name: "Record a payment" })).toHaveCount(0);
    const ledger = page.getByRole("table", { name: "Ledger entries, oldest first" });
    await expect(ledger).toContainText("Payment received (recorded by hand)");
    await expect(ledger).toContainText("BANK-778");
    expect((await adminState(request)).log.some((l: string) => l.startsWith("record-payment:INV-2026-8") && l.includes(":BANK-778:"))).toBe(true);

    await page.getByRole("link", { name: "← All invoices" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Acme Ltd" })).toContainText("Paid");
  });

  test("a bookkeeper can read invoices but not record payments or export", async ({ page, request }) => {
    await financeSeed(request, { invoices: [ACCOUNT_INVOICES[0]] });
    await signIn(page, "/admin/finance/invoices", "bookkeeper@example.test");
    await page.getByRole("link", { name: /INV-2026-8/ }).click();

    await expect(page.getByRole("heading", { name: /INV-2026-8/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Record a payment" })).toHaveCount(0);
    await page.goto("/admin/finance/reconciliation");
    await expect(page.getByText(/needs? a look/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Export the ledger" })).toHaveCount(0);
  });

  test("the detail of an online payment shows the lines, the attempt and the ledger", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000911", status: "in_transit", label: "In transit", total: 7041 }]);
    await signIn(page, "/admin/finance/invoices", "accounts@example.test");
    await page.getByRole("listitem").filter({ hasText: "LG000000000911" }).getByRole("link", { name: /INV-/ }).click();

    await expect(page.getByRole("table", { name: "Invoice lines" })).toContainText("Total$70.41");
    await expect(page.getByRole("heading", { name: "Payment attempts" }).locator("xpath=..")).toContainText("Succeeded");
    await expect(page.getByRole("table", { name: "Ledger entries, oldest first" })).toContainText("Payment received");
    await expect(page.getByRole("region", { name: "Record a payment" })).toHaveCount(0);   // paid online already
  });
});

test.describe("payments", () => {
  test("accounts see attempts with failures and duplicates flagged, and filter by status", async ({ page, request }) => {
    await financeSeed(request, { payments: [
      { id: "P1", invoice: "INV-2026-000050", provider: "sandbox", reference: "sbx_ok", status: "succeeded", failure_code: null, amount_minor: 5000, currency: "USD", duplicate: false, created_at: new Date().toISOString() },
      { id: "P2", invoice: "INV-2026-000051", provider: "sandbox", reference: null, status: "failed", failure_code: "card_declined", amount_minor: 5000, currency: "USD", duplicate: false, created_at: new Date().toISOString() },
      { id: "P3", invoice: "INV-2026-000050", provider: "sandbox", reference: "sbx_dup", status: "succeeded", failure_code: null, amount_minor: 5000, currency: "USD", duplicate: true, created_at: new Date().toISOString() },
    ] });
    await signIn(page, "/admin/finance/payments", "accounts@example.test");

    await expect(page.getByText("3 payments", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "card declined" })).toContainText("Failed");
    await expect(page.getByRole("listitem").filter({ hasText: "sbx_dup" })).toContainText("Duplicate payment");
    await page.getByLabel("Status").selectOption("failed");
    await expect(page).toHaveURL(/status=failed$/);
    await expect(page.getByText("1 payment", { exact: true })).toBeVisible();
  });
});

test.describe("reconciliation", () => {
  test("accounts see what needs a look, with the rows behind it, for a period in the address", async ({ page, request }) => {
    await financeSeed(request, {
      invoices: [ACCOUNT_INVOICES[0]],
      reconciliationExtra: { stuck_payment_attempts: { description: "Payments started more than 24 hours ago that never completed.", count: 1, rows: [{ attempt: "01ATTEMPT", invoice: "INV-2026-000050", status: "processing", created_at: "2026-10-01 08:00:00" }] } },
    });
    await signIn(page, "/admin/finance/reconciliation?from=2026-10-01&to=2026-10-15", "accounts@example.test");

    await expect(page.getByText(/Checked 2026-10-01 to 2026-10-15: 2 things need a look\./)).toBeVisible();
    expect((await adminState(request)).reconciliationQuery).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    const overdue = page.getByRole("heading", { name: "Overdue invoices on account" }).locator("xpath=ancestor::li");
    await overdue.getByText(/Show the 1 row/).click();
    await expect(overdue.getByRole("table")).toContainText("$1,500.00");
    await expect(page.getByRole("heading", { name: "Paid invoices that don't match their charges" }).locator("xpath=ancestor::li")).toContainText("All clear");
    const stuck = page.getByRole("heading", { name: "Payments that never finished" }).locator("xpath=ancestor::li");
    await expect(stuck).toContainText("1 to look at");
  });

  test("accounts download the ledger for a period, and are told when it is too large", async ({ page, request }) => {
    await signIn(page, "/admin/finance/reconciliation", "accounts@example.test");
    const panel = page.getByRole("region", { name: "Export the ledger" });
    await expect(panel.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    await panel.getByLabel("From").fill("2026-10-01");
    await panel.getByLabel("To").fill("2026-10-31");

    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("ledger-2026-10-01_2026-10-31.csv");
    await expect(panel.getByText("The ledger for 2026-10-01 to 2026-10-31 was downloaded.")).toBeVisible();
    expect((await adminState(request)).log).toContain("export:2026-10-01:2026-10-31");

    await financeSeed(request, { exportTooBig: true });
    await panel.getByRole("button", { name: "Download CSV" }).click();
    await expect(panel.getByRole("alert")).toContainText("choose a shorter period");
  });
});

test.describe("access", () => {
  test("people without finance access are told so", async ({ page }) => {
    await signIn(page, "/admin/finance/invoices", "agent@example.test");

    await expect(page.locator("main").getByRole("alert")).toContainText("doesn't have access");
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Finance" })).toHaveCount(0);
  });

  test("finance pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await financeSeed(request, { invoices: ACCOUNT_INVOICES });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/finance/invoices", "accounts@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText("3 invoices", { exact: true })).toBeVisible();
    const overflowList = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("link", { name: /INV-2026-8/ }).first().click();
    await expect(page.getByRole("table", { name: "Invoice lines" })).toBeVisible();
    const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto("/admin/finance/reconciliation");
    await expect(page.getByText(/needs? a look|everything agrees/)).toBeVisible();
    const overflowRecon = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

      return urls;
    });

    expect([overflowList, overflowDetail, overflowRecon].every((n) => n <= 1)).toBe(true);
    expect(cached.filter((path) => /^\/(admin|account)/.test(path))).toEqual([]);
    expect(violations).toEqual([]);
  });
});
