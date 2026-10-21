import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { seed, signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();
const FINDING = { index: 0, action: "restricted", label: "Batteries", reason: "Lithium cells need special packing", matched: "battery" };
const HELD = (tracking: string) => ({ tracking, status: "booking_confirmed", label: "Booking confirmed", total: 7041, compliance: { status: "review_required", findings: [FINDING] } });

test.describe("compliance review", () => {
  test("an officer sees what is held and why, approves it with a reason, and the hold is lifted", async ({ page, request }) => {
    await seed(request, [HELD("LG000000000921"), { tracking: "LG000000000922", status: "in_transit", label: "In transit" }]);
    await signIn(page, "/admin", "officer@example.test");

    await expect(page.getByRole("link", { name: /Waiting for compliance review/ })).toContainText("1");
    await page.getByRole("link", { name: /Waiting for compliance review/ }).click();
    await expect(page).toHaveURL(/\/admin\/compliance$/);
    const row = page.getByRole("link", { name: "LG000000000921" }).locator("xpath=ancestor::li");
    await expect(row).toContainText("Batteries");
    await expect(row).toContainText("Lithium cells need special packing");
    await expect(page.getByRole("link", { name: "LG000000000922" })).toHaveCount(0);

    await page.getByRole("link", { name: "LG000000000921" }).click();
    const panel = page.getByRole("region", { name: /Compliance/ });
    await expect(page.getByText("On compliance hold")).toBeVisible();
    await expect(panel.getByRole("list", { name: "What matched" })).toContainText("Item 1: Cotton shirts · matched “battery”");
    await expect(panel.getByRole("button", { name: "Review decision" })).toBeDisabled();
    await panel.getByLabel(/Reason/).fill("Packed to regulations");
    await panel.getByRole("button", { name: "Review decision" }).click();
    await expect(page.getByRole("group", { name: "Confirm decision" })).toContainText("Release the hold");
    await page.getByRole("button", { name: "Go back" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("compliance"))).toEqual([]);
    await panel.getByRole("button", { name: "Review decision" }).click();
    await page.getByRole("button", { name: "Yes, approve" }).click();

    await expect(panel).toContainText("Approved");
    await expect(panel).toContainText("Packed to regulations");
    await expect(page.getByText("On compliance hold")).toHaveCount(0);
    await expect(panel.getByRole("form", { name: "Decide" })).toHaveCount(0);
    expect((await adminState(request)).log).toContain("compliance:LG000000000921:approve:Packed to regulations");

    await page.goto("/admin/compliance");
    await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
  });

  test("rejecting says it cancels and refunds, and the shipment ends up cancelled", async ({ page, request }) => {
    await seed(request, [HELD("LG000000000931")]);
    await signIn(page, "/admin/compliance", "officer@example.test");
    await page.getByRole("link", { name: "LG000000000931" }).click();

    const panel = page.getByRole("region", { name: /Compliance/ });
    await panel.getByLabel("Reject").check();
    await panel.getByLabel(/Reason/).fill("Cannot be carried by air");
    await panel.getByRole("button", { name: "Review decision" }).click();
    await expect(page.getByRole("group", { name: "Confirm decision" })).toContainText("The booking is cancelled and $70.41 is refunded to the customer");
    await page.getByRole("button", { name: "Yes, reject and cancel" }).click();

    await expect(panel).toContainText("Rejected");
    await expect(panel).toContainText("Cannot be carried by air");
    await expect(page.getByText("Rejected by compliance", { exact: true })).toBeVisible();
    await expect(page.getByText("This shipment was cancelled: Rejected by compliance review.")).toBeVisible();
  });

  test("an operations manager sees the hold and its reasons, but cannot decide and has no compliance menu", async ({ page, request }) => {
    await seed(request, [HELD("LG000000000941")]);
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.getByRole("link", { name: "LG000000000941" }).click();

    const panel = page.getByRole("region", { name: /Compliance/ });
    await expect(panel.getByRole("list", { name: "What matched" })).toContainText("Batteries");
    await expect(panel.getByText("A compliance officer will review this.")).toBeVisible();
    await expect(panel.getByRole("form", { name: "Decide" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Customs" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Compliance" })).toHaveCount(0);
  });
});

test.describe("customs on a shipment", () => {
  test("an officer sees the checklist and what customs assessed, records a payment and a waiver", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000951", status: "in_transit", label: "In transit", charges: [
      { id: "CHA", type: "duty", description: "Import duty", amount_minor: 1250, currency: "EUR", assessed_by: "German Customs", authority_reference: "REF-9", status: "assessed" },
      { id: "CHB", type: "fee", description: "Handling fee", amount_minor: 300, currency: "EUR", assessed_by: "German Customs", status: "assessed" },
    ], declaration: { incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: null, eori_number: "NG-EORI-1", remarks: null } }]);
    await signIn(page, "/admin/shipments", "officer@example.test");
    await page.getByRole("link", { name: "LG000000000951" }).click();

    const panel = page.getByRole("region", { name: "Customs" });
    await expect(panel).toContainText("Declaration: DAP, exporting for sale · EORI NG-EORI-1");
    await expect(panel.getByRole("list", { name: "Required documents" })).toContainText("Export licence (leaving the country)");
    await expect(panel.getByText("Departure is held until the mandatory export documents are on file.")).toBeVisible();
    await expect(panel).toContainText("Estimated at booking: Import duty (estimate) $4.00.");
    const charges = panel.getByRole("list", { name: "Assessed charges" });
    await expect(charges).toContainText("Duty: €12.50");

    await panel.getByRole("button", { name: /Record payment of Import duty/ }).click();
    const pay = panel.getByRole("form", { name: "Record payment of Import duty" });
    await pay.getByLabel("Paid by").selectOption({ label: "The sender" });
    await pay.getByLabel("Payment reference").fill("DE-PAY-1");
    await pay.getByRole("button", { name: "Save payment" }).click();
    await expect(charges.getByRole("listitem").filter({ hasText: "Import duty" })).toContainText("Paid");
    expect((await adminState(request)).log).toContain("charge-paid:CHA:sender:DE-PAY-1");

    await panel.getByRole("button", { name: /Waive Handling fee/ }).click();
    await expect(page.getByRole("group", { name: "Confirm waiving Handling fee" })).toContainText("Waive €3.00?");
    await page.getByRole("button", { name: "Yes, waive it" }).click();
    await expect(charges.getByRole("listitem").filter({ hasText: "Handling fee" })).toContainText("Waived");
    expect((await adminState(request)).log).toContain("charge-waived:CHB");
  });

  test("an officer records a charge customs assessed, after checks and a confirmation", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000961", status: "in_transit", label: "In transit" }]);
    await signIn(page, "/admin/shipments", "officer@example.test");
    await page.getByRole("link", { name: "LG000000000961" }).click();

    const form = page.getByRole("form", { name: "Record a charge" });
    await form.getByRole("button", { name: "Review charge" }).click();
    await expect(form.getByText("Say what the charge is for.")).toBeVisible();
    await form.getByLabel("What it is for").fill("Import VAT");
    await form.getByLabel("Type").selectOption({ label: "Tax" });
    await form.getByLabel("Amount").fill("19.995");
    await form.getByLabel("Assessed by").fill("German customs");
    await form.getByRole("button", { name: "Review charge" }).click();
    await expect(form.getByText("Enter an amount with at most 2 decimal places.")).toBeVisible();
    await form.getByLabel("Amount").fill("19.99");
    await form.getByRole("button", { name: "Review charge" }).click();
    await expect(form.getByRole("group", { name: "Confirm charge" })).toContainText("Add a $19.99 tax charge?");
    await form.getByRole("button", { name: "Yes, add the charge" }).click();

    await expect(page.getByRole("list", { name: "Assessed charges" })).toContainText("Tax: $19.99");
    expect((await adminState(request)).log).toContain("charge:LG000000000961:tax:19.99:USD");
  });

  test("a domestic shipment has no customs panel", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000971", status: "in_transit", label: "In transit", domestic: true }]);
    await signIn(page, "/admin/shipments", "officer@example.test");
    await page.getByRole("link", { name: "LG000000000971" }).click();

    await expect(page.getByRole("heading", { name: "LG000000000971" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Customs" })).toHaveCount(0);
  });

  test("these pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await seed(request, [HELD("LG000000000981")]);
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/compliance", "officer@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("link", { name: "LG000000000981" })).toBeVisible();
    const overflowQueue = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("link", { name: "LG000000000981" }).click();
    await expect(page.getByRole("region", { name: "Customs" })).toBeVisible();
    const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

      return urls;
    });

    expect(overflowQueue).toBeLessThanOrEqual(1);
    expect(overflowDetail).toBeLessThanOrEqual(1);
    expect(cached.filter((path) => /^\/(admin|account)/.test(path))).toEqual([]);
    expect(violations).toEqual([]);
  });
});
