import { expect, test } from "@playwright/test";
import { resetCms } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("visitor sees CMS-driven home page, navigation and footer", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Stub Home");
  await expect(page.getByRole("heading", { level: 1, name: "Ship anywhere. Track everything." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Track Shipment" })).toHaveAttribute("href", "/track");
  await expect(nav.getByRole("link", { name: "About" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Members only" })).toHaveCount(0);

  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("Stub Logistics").first()).toBeVisible();
  await expect(footer.getByRole("link", { name: "hello@stub.test" })).toHaveAttribute("href", "mailto:hello@stub.test");
  await expect(footer.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("rel", /noopener/);
});

test("nested menu items open from the header and navigate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Services" }).hover();
  await page.getByRole("link", { name: "International Shipping" }).click();

  await expect(page).toHaveURL(/\/international-shipping$/);
  await expect(page.getByRole("heading", { level: 1, name: "International shipping" })).toBeVisible();
});

test("blocks awaiting backend modules render nothing in production", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText(/waiting for/)).toHaveCount(0);
  await expect(page.getByText("Quote", { exact: true })).toHaveCount(0);
});

test("responsive visibility hides desktop-only content on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByText("Visible on desktop only")).toBeVisible();
  await expect(page.getByText("Visible on mobile only")).toBeHidden();
});

test("FAQ accordion is keyboard accessible", async ({ page }) => {
  await page.goto("/about-us");
  const question = page.getByRole("button", { name: "How do I track?" });

  await expect(question).toHaveAttribute("aria-expanded", "false");
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Use the tracking box.")).toBeVisible();
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/about-us");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });

  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#content$/);
});

test("pages marked noindex in the CMS ask search engines to skip them", async ({ page }) => {
  await page.goto("/private-notes");

  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("canonical URL and description come from the CMS", async ({ page }) => {
  await page.goto("/about-us");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/about-us$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "About description");
});
