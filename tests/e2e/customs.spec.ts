import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";

const PASSWORD = "Str0ng-Passphrase-1";

test.beforeEach(async ({ request }) => resetCms(request));

const seed = (request: APIRequestContext, shipments: Record<string, unknown>[]) => request.post(`${STUB_URL}/__seed`, { data: { shipments } });
const lastUpload = async (request: APIRequestContext) => (await (await request.get(`${STUB_URL}/__shop`)).json()).lastUpload;

async function openCustoms(page: Page, tracking: string) {
  await page.goto(`/login?next=${encodeURIComponent("/account/shipments")}`);
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: tracking }).click();
  await page.getByRole("link", { name: "Complete customs details" }).click();
  await expect(page).toHaveURL(/\/shipments\/\w+\/customs$/);
  await expect(page.getByRole("heading", { name: "Customs declaration" })).toBeVisible();
}

const PDF = (name = "licence.pdf") => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF") });

test("lists what's needed and what's missing, and holds departure until the mandatory export paper is on file", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000701" }]);
  await openCustoms(page, "LG000000000701");

  await expect(page.locator("p", { hasText: "Still needed before it can leave the country:" })).toContainText("Export licence");
  const licence = page.getByRole("listitem").filter({ hasText: "Needed for goods leaving Nigeria." });
  await expect(licence).toContainText("Leaving NG · required");
  await expect(licence).toContainText("Missing");
  await expect(page.getByRole("listitem").filter({ hasText: "Packing list" }).first()).toContainText("optional");
  await expect(page.getByText("Nothing has been charged by customs.")).toBeVisible();
});

test("saves the customs declaration, keeps the confirmation visible, and remembers it on reload", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000702" }]);
  await openCustoms(page, "LG000000000702");

  await page.getByRole("button", { name: "Save declaration" }).click();
  await expect(page.getByLabel(/Delivery terms/)).toHaveAccessibleDescription(/Choose a delivery term/);

  await page.getByLabel(/Delivery terms/).selectOption("DAP");
  await page.getByLabel("Reason for sending").selectOption("sale");
  await page.getByLabel(/EORI number/).fill("12345");
  await page.getByRole("button", { name: "Save declaration" }).click();
  await expect(page.getByText(/An EORI number is two letters/)).toBeVisible();

  await page.getByLabel(/EORI number/).fill("de123456789");
  await page.getByRole("button", { name: "Save declaration" }).click();
  await expect(page.getByText("Your declaration has been saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update declaration" })).toBeVisible();
  await expect(page.getByText("Your declaration has been saved.")).toBeVisible();   // still there after the page refreshed its data

  await page.reload();
  await expect(page.getByLabel(/Delivery terms/)).toHaveValue("DAP");
  await expect(page.getByLabel(/EORI number/)).toHaveValue("DE123456789");
});

test("uploads a document, which then counts as on file and can be downloaded", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000703" }]);
  await openCustoms(page, "LG000000000703");

  await page.getByLabel("Choose export licence file").setInputFiles(PDF());
  await expect(page.getByText("licence.pdf was uploaded.")).toBeVisible();
  expect(await lastUpload(request)).toMatchObject({ type: "export_licence", filename: "licence.pdf" });

  const licence = page.getByRole("listitem").filter({ hasText: "Needed for goods leaving Nigeria." });
  await expect(licence).toContainText("On file");
  await expect(page.getByText("Every document we need before this shipment leaves the country is on file.")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download licence\.pdf/ }).click()]);
  expect(download.suggestedFilename()).toBe("invoice.pdf");
  await expect(page).toHaveURL(/\/customs$/);
});

test("refuses files that aren't PDF, JPEG or PNG, before and after they reach the server", async ({ page, request }, testInfo) => {
  await seed(request, [{ tracking: "LG000000000704" }]);
  await openCustoms(page, "LG000000000704");

  await page.getByLabel("Choose export licence file").setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText("Only PDF, JPEG and PNG files are accepted.")).toBeVisible();
  expect(await lastUpload(request)).toBeNull();

  const disguised = testInfo.outputPath("fake.pdf");
  await writeFile(disguised, "<html>not really a pdf</html>");
  await page.getByLabel("Choose export licence file").setInputFiles(disguised);
  await expect(page.getByText(/genuine PDF, JPEG or PNG/)).toBeVisible();
  await expect(page.getByText(/Still needed before it can leave the country/)).toBeVisible();
});

test("creates the commercial invoice and packing list for the customer once the declaration is saved", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000705" }]);
  await openCustoms(page, "LG000000000705");

  await expect(page.getByRole("button", { name: "Create commercial invoice for me" })).toBeDisabled();
  await page.getByLabel(/Delivery terms/).selectOption("DAP");
  await page.getByLabel("Reason for sending").selectOption("gift");
  await page.getByRole("button", { name: "Save declaration" }).click();
  await expect(page.getByText("Your declaration has been saved.")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Create commercial invoice for me" }).click()]);
  expect(download.suggestedFilename()).toBe("invoice.pdf");
  await expect(page.getByText(/Commercial invoice created from your shipment details/)).toBeVisible();

  const filed = page.getByRole("heading", { name: "Documents on file" }).locator("..");
  await expect(filed).toContainText("created for you");
  await expect(page.getByRole("listitem").filter({ hasText: "Entering DE · required" })).toContainText("On file");
});

test("shows the compliance outcome, estimates and what customs actually charged, kept apart", async ({ page, request }) => {
  await seed(request, [{
    tracking: "LG000000000706", compliance: { status: "review_required", note: null },
    charges: [{ id: "C1", type: "duty", description: "Import duty", amount_minor: 1250, currency: "EUR", assessed_by: "German Customs", authority_reference: "REF-9", status: "assessed", paid_at: null }],
  }]);
  await openCustoms(page, "LG000000000706");

  await expect(page.getByText("On hold for a compliance check.")).toBeVisible();
  const estimated = page.getByRole("heading", { name: "Estimated" }).locator("..");
  const charged = page.getByRole("heading", { name: "Charged by customs" }).locator("..");
  await expect(estimated).toContainText("not charges and not included in what you paid");
  await expect(estimated).toContainText("Import duty (estimate)");
  await expect(charged).toContainText("12.50");
  await expect(charged).toContainText("German Customs · reference REF-9");
  await expect(charged).toContainText("Payable");
});

test("a domestic shipment has no customs page content and no link to it", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000707", domestic: true }]);
  await page.goto("/login?next=%2Faccount%2Fshipments");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "LG000000000707" }).click();

  await expect(page.locator("#tracking-heading")).toHaveText("LG000000000707");
  await expect(page.getByRole("link", { name: "Complete customs details" })).toHaveCount(0);

  const id = page.url().split("/").pop();
  await page.goto(`/shipments/${id}/customs`);
  await expect(page.getByText("stays within one country")).toBeVisible();
});

test("a finished shipment's customs page is view-only", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000708", status: "in_transit", label: "In transit", cancellable: false }]);
  await openCustoms(page, "LG000000000708");
  await expect(page.getByLabel(/Delivery terms/)).toBeEnabled();

  await request.post(`${STUB_URL}/__seed`, { data: { shipments: [{ tracking: "LG000000000709", status: "delivered", label: "Delivered", cancellable: false }] } });
  await page.goto("/account/shipments?status=delivered");
  await page.getByRole("link", { name: "LG000000000709" }).click();
  await page.getByRole("link", { name: "Complete customs details" }).click();

  await expect(page.getByLabel(/Delivery terms/)).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Upload / })).toHaveCount(0);
});

test("a guest can complete customs details in the tab they booked in", async ({ page }) => {
  await page.goto("/quote");
  const from = page.getByRole("group", { name: "Sending from" });
  const to = page.getByRole("group", { name: "Sending to" });
  await expect(to.getByRole("option", { name: "Germany" })).toBeAttached();
  await from.getByLabel("Country").selectOption("NG");
  await from.getByLabel("City").fill("Lagos");
  await to.getByLabel("Country").selectOption("DE");
  await to.getByLabel("City").fill("Berlin");
  await to.getByLabel(/Postal code/).fill("10115");
  await page.getByLabel(/Contents/).fill("Books");
  for (const [label, value] of [["Weight (kg)", "2"], ["Length (cm)", "30"], ["Width (cm)", "20"], ["Height (cm)", "10"]] as const) await page.getByLabel(label).fill(value);
  await page.getByLabel(/Declared value/).fill("100");
  await page.getByRole("button", { name: "Get prices" }).click();
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await page.getByLabel("Your email").fill("guest@example.test");
  const s = page.getByRole("group", { name: "Sender (collection address)" });
  const r = page.getByRole("group", { name: "Recipient (delivery address)" });
  await s.getByLabel("Full name").fill("Ife Okoro");
  await s.getByLabel("Phone").fill("+2348012345678");
  await s.getByLabel("Address", { exact: true }).fill("1 Marina Road");
  await s.getByLabel("State").fill("Lagos");
  await r.getByLabel("Full name").fill("Hans Becker");
  await r.getByLabel("Phone").fill("+4915112345678");
  await r.getByLabel("Address", { exact: true }).fill("2 Unter den Linden");
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Pay (simulate success)" }).click();
  await page.getByRole("link", { name: "Complete customs details" }).click();

  await page.getByLabel(/Delivery terms/).selectOption("DDP");
  await page.getByLabel("Reason for sending").selectOption("sample");
  await page.getByRole("button", { name: "Save declaration" }).click();
  await expect(page.getByText("Your declaration has been saved.")).toBeVisible();
  await page.getByLabel("Choose export licence file").setInputFiles(PDF());
  await expect(page.getByText("licence.pdf was uploaded.")).toBeVisible();
});

test("these pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await seed(request, [{ tracking: "LG000000000710" }]);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await openCustoms(page, "LG000000000710");
  await page.getByLabel("Choose export licence file").setInputFiles(PDF());
  await expect(page.getByText("licence.pdf was uploaded.")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Documents we need" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(overflow).toBeLessThanOrEqual(1);
  expect(cached.filter((path) => /^\/(shipments|account)/.test(path))).toEqual([]);
  expect(violations).toEqual([]);
});

test("a wrongly uploaded document can be removed, which puts the requirement back to missing", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000731" }]);
  await openCustoms(page, "LG000000000731");
  await page.getByLabel("Choose export licence file").setInputFiles(PDF());
  await expect(page.getByText("licence.pdf was uploaded.")).toBeVisible();

  await page.getByRole("button", { name: /^Remove licence\.pdf/ }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: /Download licence\.pdf/ })).toBeVisible();

  await page.getByRole("button", { name: /^Remove licence\.pdf/ }).click();
  await page.getByRole("button", { name: /^Yes, remove/ }).click();

  await expect(page.getByRole("button", { name: /Download licence\.pdf/ })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Needed for goods leaving Nigeria." })).toContainText("No export licence on file.");
  expect((await (await request.get(`${STUB_URL}/__shop`)).json()).removedDocuments).toEqual(["licence.pdf"]);
});

test("once the shipment is with customs, documents can no longer be removed", async ({ page, request }) => {
  await seed(request, [{ tracking: "LG000000000732" }]);
  await openCustoms(page, "LG000000000732");
  await page.getByLabel("Choose export licence file").setInputFiles(PDF());
  await expect(page.getByText("licence.pdf was uploaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove licence\.pdf/ })).toBeVisible();

  await request.post(`${STUB_URL}/__shipment-status`, { data: { tracking: "LG000000000732", status: "export_clearance", label: "Export clearance" } });
  await page.reload();

  await expect(page.getByRole("button", { name: /Download licence\.pdf/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove licence\.pdf/ })).toHaveCount(0);
});
