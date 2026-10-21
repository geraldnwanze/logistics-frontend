import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms, setCmsState } from "./support/cms";

const PASSWORD = "Str0ng-Passphrase-1";

test.beforeEach(async ({ request }) => resetCms(request));

const shopDefaults = { quotes: {}, shipments: {}, idempotency: {}, created: 0, payments: {}, sandboxOff: false, paymentDown: false, confirmDelay: 0 };
const setShop = (request: APIRequestContext, over: Record<string, unknown>) => setCmsState(request, { shop: { ...shopDefaults, ...over } });
const stubShop = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__shop`)).json();

async function fillQuote(page: Page, over: { contents?: string; declared?: string; destination?: string; postal?: string } = {}) {
  await page.goto("/quote");
  const from = page.getByRole("group", { name: "Sending from" });
  const to = page.getByRole("group", { name: "Sending to" });
  await expect(to.getByRole("option", { name: "Germany" })).toBeAttached();
  await from.getByLabel("Country").selectOption("NG");
  await from.getByLabel("City").fill("Lagos");
  await to.getByLabel("Country").selectOption(over.destination ?? "DE");
  await to.getByLabel("City").fill("Berlin");
  await to.getByLabel(/Postal code/).fill(over.postal ?? "10115");
  await page.getByLabel(/Contents/).fill(over.contents ?? "Clothing samples");
  await page.getByLabel("Weight (kg)").fill("2");
  await page.getByLabel("Length (cm)").fill("30");
  await page.getByLabel("Width (cm)").fill("20");
  await page.getByLabel("Height (cm)").fill("10");
  await page.getByLabel(/Declared value/).fill(over.declared ?? "100");
  await page.getByRole("button", { name: "Get prices" }).click();
}

async function fillBooking(page: Page, email = "ife@example.test") {
  if (email) await page.getByLabel("Your email").fill(email);
  const sender = page.getByRole("group", { name: "Sender (collection address)" });
  const recipient = page.getByRole("group", { name: "Recipient (delivery address)" });
  await sender.getByLabel("Full name").fill("Ife Okoro");
  await sender.getByLabel("Phone").fill("+2348012345678");
  await sender.getByLabel("Address", { exact: true }).fill("1 Marina Road");
  await sender.getByLabel("State").fill("Lagos");
  await recipient.getByLabel("Full name").fill("Hans Becker");
  await recipient.getByLabel("Phone").fill("+4915112345678");
  await recipient.getByLabel("Address", { exact: true }).fill("2 Unter den Linden");
  await page.getByLabel(/I accept the terms/).check();
}

test("a guest gets prices, books, pays in the sandbox, and sees a confirmed shipment", async ({ page, request }) => {
  await setShop(request, { confirmDelay: 1 });
  await fillQuote(page);

  await expect(page).toHaveURL(/\/quote\/01QUOTE000001$/);
  await expect(page.getByRole("heading", { name: "International Economy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "International Express" })).toBeVisible();
  await expect(page.getByText(/Not included: estimated import duties/).first()).toBeVisible();
  await expect(page.getByText(/Services that can't carry this shipment/)).toBeVisible();

  await page.getByRole("link", { name: "Book International Economy" }).click();
  await expect(page).toHaveURL(/\/book\/01QUOTE000001\?option=01QUOTE000001OPT1$/);
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Clothing samples");
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();

  await expect(page).toHaveURL(/\/sandbox-pay\?reference=sbx_[\w-]+&shipment=01SHIP/);
  await expect(page.getByRole("note")).toContainText("No card is charged");
  expect(page.url()).not.toContain("guest-token");

  await page.getByRole("button", { name: "Pay (simulate success)" }).click();
  await expect(page).toHaveURL(/\/shipments\/01SHIP\w+\?returned=1$/);
  await expect(page.getByText("LG000000000001")).toBeVisible();
  await expect(page.getByText("Waiting for your payment to be confirmed…")).toBeVisible();
  await expect(page.getByText("Payment received. Your shipment is confirmed.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Track this shipment" }).click();
  await expect(page).toHaveURL(/\/track\/LG000000000001$/);

  const sent = await stubShop(request);
  expect(sent.booking).toMatchObject({ contact_email: "ife@example.test", terms_accepted: true, items: [{ description: "Clothing samples", quantity: 1, unit_value: "100.00" }] });
});

test("the quote form catches mistakes before sending and shows the API's complaints beside the field", async ({ page }) => {
  await page.goto("/quote");
  await expect(page.getByRole("group", { name: "Sending to" }).getByRole("option", { name: "Germany" })).toBeAttached();
  await page.getByRole("button", { name: "Get prices" }).click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
  await expect(page.getByLabel("Weight (kg)")).toHaveAccessibleDescription("Required.");

  await fillQuote(page, { contents: "trigger-422" });
  await expect(page.getByText("The contents field is not acceptable.")).toBeVisible();
  await expect(page).toHaveURL(/\/quote$/);
});

test("switching units clears the measurements and quotes in pounds and inches", async ({ page, request }) => {
  await page.goto("/quote");
  await expect(page.getByRole("group", { name: "Sending to" }).getByRole("option", { name: "Germany" })).toBeAttached();
  await page.getByLabel("Weight (kg)").fill("2");
  await page.getByLabel("Pounds and inches").check();
  await expect(page.getByLabel("Weight (lb)")).toHaveValue("");

  await page.getByRole("group", { name: "Sending from" }).getByLabel("Country").selectOption("NG");
  await page.getByRole("group", { name: "Sending from" }).getByLabel("City").fill("Lagos");
  await page.getByRole("group", { name: "Sending to" }).getByLabel("Country").selectOption("DE");
  await page.getByRole("group", { name: "Sending to" }).getByLabel("City").fill("Berlin");
  await page.getByRole("group", { name: "Sending to" }).getByLabel(/Postal code/).fill("10115");
  await page.getByLabel(/Contents/).fill("Books");
  await page.getByLabel("Weight (lb)").fill("10");
  await page.getByLabel("Length (in)").fill("12");
  await page.getByLabel("Width (in)").fill("8");
  await page.getByLabel("Height (in)").fill("4");
  await page.getByRole("button", { name: "Get prices" }).click();

  await expect(page).toHaveURL(/\/quote\/01QUOTE/);
  expect((await stubShop(request)).quoteRequest).toMatchObject({ unit_system: "imperial", packages: [{ weight_lb: "10", length_in: "12", width_in: "8", height_in: "4" }] });
});

test("when no service can carry the shipment, it says so and why", async ({ page }) => {
  await fillQuote(page, { destination: "GB", postal: "SW1A 1AA" });

  await expect(page.getByText("None of our services can carry this shipment")).toBeVisible();
  await page.getByText(/Services that can't carry this shipment/).click();
  await expect(page.getByText("This service doesn't run between these places.")).toBeVisible();
});

test("expired prices can't be booked, and an unknown quote says so", async ({ page }) => {
  await page.goto("/quote/01EXPIREDQUOTE000000000");
  await expect(page.locator("main").getByRole("alert")).toContainText("These prices have expired");
  await expect(page.getByRole("button", { name: "Prices expired" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Prices expired" }).first()).toBeDisabled();

  await page.goto("/book/01EXPIREDQUOTE000000000?option=x");
  await expect(page.locator("main").getByRole("alert")).toContainText("prices have expired");

  await page.goto("/quote/does-not-exist");
  await expect(page.locator("main").getByRole("alert")).toContainText("couldn't find this quote");
});

test("the booking form checks the items against the declared value and the country's rules", async ({ page }) => {
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);

  await page.getByLabel(/Value each/).fill("99.99");
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await expect(page.getByText(/add up to .*99\.99.*declared .*100\.00/)).toBeVisible();

  await page.getByLabel(/Value each/).fill("100.00");
  await page.getByRole("group", { name: "Sender (collection address)" }).getByLabel("State").fill("");
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await expect(page.getByText("State is required for this country.")).toBeVisible();
  await expect(page).toHaveURL(/\/book\//);
});

test("double-clicking Book creates only one shipment", async ({ page, request }) => {
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);

  await page.getByRole("button", { name: /Book and pay/ }).dblclick();

  await expect(page).toHaveURL(/\/sandbox-pay/);
  expect((await stubShop(request)).created).toBe(1);
});

test("if the payment can't be started, the booking is kept and payment can be retried from the shipment page", async ({ page, request }) => {
  await setShop(request, { paymentDown: true });
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();

  await expect(page).toHaveURL(/\/shipments\/01SHIP\w+\?payment=error$/);
  await expect(page.getByText(/Your booking is saved, but we couldn't start the payment/)).toBeVisible();

  await setShop(request, { quotes: (await stubShopState(request)).quotes, shipments: (await stubShopState(request)).shipments, created: 1 });
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page).toHaveURL(/\/sandbox-pay\?reference=/);
});

async function stubShopState(request: APIRequestContext) {
  return (await (await request.post(`${STUB_URL}/__state`, { data: {} })).json()).shop as { quotes: Record<string, unknown>; shipments: Record<string, unknown> };
}

test("a declined sandbox payment leaves the booking unpaid with a way to try again", async ({ page }) => {
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Decline (simulate failure)" }).click();

  await expect(page).toHaveURL(/\/shipments\/01SHIP\w+\?returned=1&payment=error$/);
  await expect(page.getByText("Payment needed")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay / })).toBeVisible();
});

test("sandbox payments say so where they don't exist", async ({ page, request }) => {
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await setShop(request, { ...(await stubShopState(request)), sandboxOff: true });

  await page.getByRole("button", { name: "Pay (simulate success)" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText("Sandbox payments aren't available");
});

test("a guest's access lasts for the tab: reload works, a fresh browser can only track", async ({ page, browser, request }) => {
  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Pay (simulate success)" }).click();
  await expect(page).toHaveURL(/\/shipments\/01SHIP\w+\?returned=1$/);
  const shipmentUrl = page.url();

  await page.reload();
  await expect(page.getByText("LG000000000001")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("guest-token:")).length)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("guest-token");

  const stranger = await browser.newPage();
  await stranger.goto(shipmentUrl);
  await expect(stranger.locator("main").getByRole("alert")).toContainText("same browser tab you booked in");
  await stranger.close();
  void request;
});

test("a signed-in customer isn't asked for an email, and the shipment belongs to the account", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);

  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await expect(page.getByLabel("Your email")).toHaveCount(0);
  await fillBooking(page, "");
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Pay (simulate success)" }).click();

  await expect(page.getByText("LG000000000001")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("guest-token:")).length)).toBe(0);
});

test("the flow works under the security policy and none of it is saved offline", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  await fillQuote(page);
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await fillBooking(page);
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Pay (simulate success)" }).click();
  await expect(page.getByText("LG000000000001")).toBeVisible();

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(cached.filter((path) => /^\/(book|shipments|sandbox-pay|quote\/)/.test(path))).toEqual([]);
  expect(violations).toEqual([]);
});

test("the quote page itself is usable on a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/quote");
  await expect(page.getByRole("group", { name: "Sending to" }).getByRole("option", { name: "Germany" })).toBeAttached();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
