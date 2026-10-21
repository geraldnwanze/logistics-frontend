import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { post, signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();
const rulesSeed = (request: APIRequestContext, data: Record<string, unknown>) => post(request, "/__admin-seed", data);

const RESTRICTIONS = [
  { label: "Batteries", action: "restricted", keywords: ["battery", "lithium"], hs_prefixes: ["8507"], reason: "Lithium cells need special packing" },
  { label: "Firearms", action: "prohibited", keywords: ["firearm"], country_code: "DE", applies_to: "destination" },
  { label: "Old tobacco rule", action: "prohibited", keywords: ["tobacco"], is_active: false },
  { label: "Locked rule", action: "restricted", keywords: ["locked"], inUse: true },
];

test.describe("screening rules", () => {
  test("an officer sees the rules most serious first, and narrows them with filters kept in the address", async ({ page, request }) => {
    await rulesSeed(request, { restrictions: RESTRICTIONS });
    await signIn(page, "/admin/rules/screening", "officer@example.test");

    const items = page.getByRole("list", { name: "Rules" }).getByRole("listitem");
    await expect(items.first()).toContainText("Firearms");
    await expect(items.first()).toContainText("Sending to · only DE");
    await expect(page.getByText("4 rules", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Old tobacco rule" })).toContainText("Not in use");

    await page.getByLabel("In use").selectOption("Not in use");
    await expect(page).toHaveURL(/active=0$/);
    await expect(page.getByText("1 rule", { exact: true })).toBeVisible();
    expect((await adminState(request)).restrictionQuery).toMatchObject({ active: "0" });

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByLabel("Name").fill("batt");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=batt$/);
    await expect(page.getByRole("listitem").filter({ hasText: "Batteries" })).toContainText("Code prefixes: 8507");
    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("batt");
  });

  test("an officer adds a rule after the form checks it, and the API's refusals are shown in plain words", async ({ page, request }) => {
    await signIn(page, "/admin/rules/screening", "officer@example.test");
    await page.getByRole("button", { name: "New rule" }).click();
    const form = page.getByRole("form", { name: "Add rule" });

    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByText("Give the rule a name people will recognise.")).toBeVisible();
    await expect(form.getByText(/Add at least one keyword/)).toBeVisible();

    await form.getByLabel("Name").fill("Power tools");
    await form.getByLabel("What happens").selectOption({ label: "Prohibited: refuse the booking" });
    await form.getByLabel("Keywords").fill("chainsaw, nail gun\nchainsaw");
    await form.getByLabel(/Only for this country/).fill("ZZ");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(form.getByText("The selected country code is invalid.")).toBeVisible();
    await expect(form.getByLabel("Name")).toHaveValue("Power tools");

    await form.getByLabel(/Only for this country/).fill("DE");
    await form.getByRole("button", { name: "Add rule" }).click();

    await expect(page.getByText("“Power tools” was added.")).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Power tools" });
    await expect(row).toContainText("Prohibited");
    await expect(row).toContainText("Keywords: chainsaw, nail gun");
    await expect(row).toContainText("only DE");
    expect((await adminState(request)).log).toContain("rule-add:Power tools:prohibited");
  });

  test("an officer edits a rule, turns it off and on, and deletes one only after confirming", async ({ page, request }) => {
    await rulesSeed(request, { restrictions: RESTRICTIONS });
    await signIn(page, "/admin/rules/screening", "officer@example.test");
    const batteries = () => page.getByRole("listitem").filter({ hasText: "Batteries" });

    await batteries().getByRole("button", { name: /Edit Batteries/ }).click();
    const form = page.getByRole("form", { name: "Save changes" });
    await expect(form.getByLabel("Keywords")).toHaveValue("battery, lithium");
    await form.getByLabel("What happens").selectOption({ label: "Prohibited: refuse the booking" });
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("“Batteries” was saved.")).toBeVisible();
    await expect(batteries()).toContainText("Prohibited");

    await batteries().getByRole("button", { name: /Turn off Batteries/ }).click();
    await expect(page.getByText("“Batteries” is now off.")).toBeVisible();
    await expect(batteries()).toContainText("Not in use");
    await batteries().getByRole("button", { name: /Turn on Batteries/ }).click();
    await expect(page.getByText("“Batteries” is now in use.")).toBeVisible();

    await batteries().getByRole("button", { name: /Delete Batteries/ }).click();
    await expect(page.getByRole("group", { name: "Confirm deleting Batteries" })).toContainText("will no longer be screened");
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(batteries()).toBeVisible();
    await batteries().getByRole("button", { name: /Delete Batteries/ }).click();
    await page.getByRole("button", { name: "Yes, delete it" }).click();
    await expect(page.getByText("“Batteries” was deleted.")).toBeVisible();
    await expect(batteries()).toHaveCount(0);
    expect((await adminState(request)).log).toContain("rule-delete:Batteries");

    const locked = page.getByRole("listitem").filter({ hasText: "Locked rule" });
    await locked.getByRole("button", { name: /Delete Locked rule/ }).click();
    await page.getByRole("button", { name: "Yes, delete it" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("Disable or archive it instead.");
    await expect(locked).toBeVisible();
  });
});

test.describe("document requirements", () => {
  const REQUIREMENTS = [
    { country_code: "NG", direction: "export", document_type: "export_licence", label: "Export licence", notes: "Needed for goods leaving Nigeria." },
    { country_code: "DE", direction: "import", document_type: "commercial_invoice", label: "Commercial invoice", shipment_types: ["parcel"], min_declared_value_minor: 15000, value_currency: "USD", is_mandatory: false },
  ];

  test("an officer sees which documents each country asks for, and when", async ({ page, request }) => {
    await rulesSeed(request, { requirements: REQUIREMENTS });
    await signIn(page, "/admin/rules/documents", "officer@example.test");

    const german = page.getByRole("listitem").filter({ hasText: "DE · Arriving in the country" });
    await expect(german).toContainText("For parcels, declared at $150.00 or more.");
    await expect(german).toContainText("Optional");
    await expect(page.getByRole("listitem").filter({ hasText: "NG · Leaving the country" })).toContainText("For every kind of shipment, of any value.");

    await page.getByLabel("Which way").selectOption({ label: "Leaving the country" });
    await expect(page).toHaveURL(/direction=export$/);
    await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByLabel("Country").fill("de");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/country=DE$/);
    expect((await adminState(request)).requirementQuery).toMatchObject({ country: "DE" });
    await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();
  });

  test("an officer adds, edits and removes a requirement, with the threshold in the right currency", async ({ page, request }) => {
    await rulesSeed(request, { requirements: [REQUIREMENTS[0]] });
    await signIn(page, "/admin/rules/documents", "officer@example.test");
    await page.getByRole("button", { name: "New requirement" }).click();
    const form = page.getByRole("form", { name: "Add requirement" });

    await form.getByRole("button", { name: "Add requirement" }).click();
    await expect(form.getByText("Use the two-letter country code, for example DE.")).toBeVisible();
    await form.getByLabel("Country").fill("de");
    await form.getByLabel("What the customer sees").fill("Packing list");
    await form.getByLabel("Document", { exact: true }).selectOption({ label: "Packing list" });
    await form.getByLabel("Which way").selectOption({ label: "Arriving in the country" });
    await form.getByLabel("Parcels").check();
    await form.getByLabel(/Only when the declared value/).fill("150.005");
    await form.getByRole("button", { name: "Add requirement" }).click();
    await expect(form.getByText(/at most 2 decimal places/)).toBeVisible();
    await form.getByLabel(/Only when the declared value/).fill("150.50");
    await form.getByRole("button", { name: "Add requirement" }).click();

    await expect(page.getByText("A requirement for DE was added.")).toBeVisible();
    expect((await adminState(request)).log).toContain("req-add:DE:import:packing_list:15050:USD");
    const added = page.getByRole("listitem").filter({ hasText: "DE · Arriving in the country" });
    await expect(added).toContainText("declared at $150.50 or more");

    await added.getByRole("button", { name: /Edit Packing list for DE/ }).click();
    const edit = page.getByRole("form", { name: "Save changes" });
    await expect(edit.getByLabel(/Only when the declared value/)).toHaveValue("150.50");
    await edit.getByLabel("Required before the shipment can leave").uncheck();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(added).toContainText("Optional");

    await added.getByRole("button", { name: /Delete Packing list for DE/ }).click();
    await page.getByRole("button", { name: "Yes, delete it" }).click();
    await expect(page.getByText("Packing list for DE was deleted.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "DE · Arriving" })).toHaveCount(0);
  });
});

test.describe("access", () => {
  test("an operations manager has no Rules menu and is told so on the page", async ({ page }) => {
    await signIn(page, "/admin/rules/screening", "ops@example.test");

    await expect(page.locator("main").getByRole("alert")).toContainText("doesn't have access");
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Rules" })).toHaveCount(0);
  });

  test("the rules pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await rulesSeed(request, { restrictions: RESTRICTIONS, requirements: [{ country_code: "NG", direction: "export", document_type: "export_licence", label: "Export licence" }] });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/rules/screening", "officer@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText("4 rules", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New rule" }).click();
    await expect(page.getByRole("form", { name: "Add rule" })).toBeVisible();
    const overflowRules = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto("/admin/rules/documents");
    await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();
    const overflowDocs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

      return urls;
    });

    expect(overflowRules).toBeLessThanOrEqual(1);
    expect(overflowDocs).toBeLessThanOrEqual(1);
    expect(cached.filter((path) => /^\/(admin|account)/.test(path))).toEqual([]);
    expect(violations).toEqual([]);
  });
});
