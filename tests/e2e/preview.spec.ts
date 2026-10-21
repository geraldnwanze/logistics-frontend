import { expect, test } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";

const preview = (query: string) => `/preview?url=${encodeURIComponent(query)}`;

test("a valid signed link shows the draft with a visible banner and noindex", async ({ page }) => {
  await page.goto(preview(`${STUB_URL}/api/v1/public/preview/01HOME?signature=valid`));

  await expect(page.getByRole("status").filter({ hasText: "Draft preview — not published" })).toBeVisible();
  await expect(page.getByText("Draft only content")).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("an expired or tampered link is refused", async ({ page }) => {
  await page.goto(preview(`${STUB_URL}/api/v1/public/preview/01HOME?signature=expired`));

  await expect(page.getByRole("heading", { name: "Preview unavailable" })).toBeVisible();
  await expect(page.getByText("Draft only content")).toHaveCount(0);
});

test("links to other hosts are never fetched", async ({ page }) => {
  await page.goto(preview("https://evil.test/api/v1/public/preview/01HOME?signature=valid"));
  await expect(page.getByRole("heading", { name: "Preview unavailable" })).toBeVisible();

  await page.goto("/preview");
  await expect(page.getByRole("heading", { name: "Preview unavailable" })).toBeVisible();
});
