import { expect, test } from "@playwright/test";
import { resetCms } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("mobile navigation opens, lists CMS menu items and navigates", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "International Shipping" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Members only" })).toHaveCount(0);

  await dialog.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about-us$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("mobile menu closes with Escape and returns focus to its button", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open menu" });

  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("mobile-only blocks show and desktop-only blocks hide", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Visible on mobile only")).toBeVisible();
  await expect(page.getByText("Visible on desktop only")).toBeHidden();
});

test("the page does not scroll horizontally", async ({ page }) => {
  await page.goto("/");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("tap targets in the header are at least 44px", async ({ page }) => {
  await page.goto("/");
  const box = await page.getByRole("button", { name: "Open menu" }).boundingBox();

  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
