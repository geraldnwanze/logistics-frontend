import { expect, test } from "@playwright/test";
import { resetCms, setCmsState } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("visitor enters a tracking number from the home hero", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tracking number").first().fill("LG-1234ABCD");
  await page.getByRole("button", { name: "Track" }).first().click();

  await expect(page).toHaveURL(/\/track\/LG-1234ABCD$/);
  await expect(page.getByRole("heading", { name: "Track shipment" })).toBeVisible();
});

test("invalid numbers are rejected on the client with an accessible message", async ({ page }) => {
  await page.goto("/track");
  const input = page.getByLabel("Tracking number");

  await input.fill("x");
  await input.press("Enter");

  await expect(page.locator("p[role=alert]")).toContainText("6–40");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/track$/);
});

test("shows live status, route and history for a known number, typed with dashes and lower case", async ({ page }) => {
  await page.goto("/track/lg-000000000001");

  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toBeVisible();
  await expect(page.getByText("Demonstration shipment")).toBeVisible();
  await expect(page.getByText("Frankfurt, DE").first()).toBeVisible();
  await expect(page.locator("article").getByRole("listitem").first()).toContainText("In transit");
  await expect(page.locator("article").getByRole("listitem").last()).toContainText("Booking confirmed");
});

test("an unknown number says so and never shows a status", async ({ page }) => {
  await page.goto("/track/LG000000000404");

  await expect(page.locator("main").getByRole("alert")).toContainText("couldn't find a shipment");
  for (const status of ["Delivered", "In transit", "Out for delivery"]) {
    await expect(page.getByRole("heading", { name: status, level: 2 })).toHaveCount(0);
  }
});

test("rate limiting is explained, not shown as a failure to find the shipment", async ({ page }) => {
  await page.goto("/track/LG000000000429");

  await expect(page.locator("main").getByRole("alert")).toContainText("Too many lookups");
  await expect(page.locator("main").getByRole("alert")).toContainText("45 seconds");
});

test("delivered shipments show who received them (masked) and no estimate", async ({ page }) => {
  await page.goto("/track/LG000000000002");

  await expect(page.getByRole("heading", { name: "Delivered", level: 2 })).toBeVisible();
  await expect(page.getByText("Received by H. B.")).toBeVisible();
  await expect(page.getByText("(estimate)")).toHaveCount(0);
});

test("when the tracking service is down and nothing is saved, the visitor gets an honest error", async ({ page, request }) => {
  await setCmsState(request, { trackingDown: true });
  await page.goto("/track/LG000000000001");

  await expect(page.locator("main").getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toHaveCount(0);
});

test("a result seen once is still readable offline, marked as a saved copy", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the worker take control so it can save the page shell
  await page.goto("/track/LG000000000001");
  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toBeVisible();

  await context.setOffline(true);
  await page.goto("/track/LG000000000001");

  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toBeVisible();
  await expect(page.getByText(/saved on this device on/)).toBeVisible();
  await expect(page.getByText(/newer updates may be missing/)).toBeVisible();

  await page.goto("/track/LG000000000009"); // never opened: the worker has no page for it, so it shows the offline page
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toHaveCount(0);

  await context.setOffline(false);
});

test("removing the saved copy forgets it", async ({ page }) => {
  await page.goto("/track/LG000000000001");
  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tracking:saved:v1"))).not.toBeNull();

  await page.getByRole("button", { name: "Remove saved tracking" }).click();

  expect(await page.evaluate(() => localStorage.getItem("tracking:saved:v1"))).toBeNull();
});

test("hostile tracking numbers are rendered as text, not markup", async ({ page }) => {
  await page.goto("/track/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");

  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
});
