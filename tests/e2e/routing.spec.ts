import { expect, test } from "@playwright/test";
import { resetCms } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("a renamed page redirects to its new address", async ({ page }) => {
  await page.goto("/old-name");

  await expect(page).toHaveURL(/\/about-us$/);
  await expect(page.getByRole("heading", { name: "About us" })).toBeVisible();
});

test("/home is not a second address for the home page", async ({ page }) => {
  await page.goto("/home");

  await expect(page).toHaveURL(/\/$/);
});

test("unknown pages show the not-found page and are excluded from search", async ({ page }) => {
  await page.goto("/does-not-exist");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("deeply nested unknown paths do not crash", async ({ page }) => {
  const response = await page.goto("/a/b/c/d");

  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
