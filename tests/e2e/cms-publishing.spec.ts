import { expect, test } from "@playwright/test";
import { expectEventually, resetCms, revalidateAll, setCmsState } from "./support/cms";
import { REVALIDATE_SECRET } from "../../playwright.config";

test.beforeEach(async ({ request }) => resetCms(request));
test.afterAll(async ({ request }) => resetCms(request));

test("a CMS change appears on the site after revalidation, without a deployment", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ship anywhere. Track everything.");

  await setCmsState(request, { homeHeadline: "Fast, reliable delivery worldwide" });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ship anywhere. Track everything.");

  await revalidateAll(request, ["/"]);
  await expectEventually(page, async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fast, reliable delivery worldwide");
  });
});

test("an announcement bar and maintenance mode follow the CMS settings", async ({ page, request }) => {
  await setCmsState(request, { announcement: { enabled: true, text: "Holiday delays expected", link: null, tone: "warning" } });
  await revalidateAll(request);
  await page.goto("/");
  await expectEventually(page, async () => {
    await expect(page.getByRole("status").filter({ hasText: "Holiday delays expected" })).toBeVisible();
  });

  await setCmsState(request, { maintenance: true });
  await revalidateAll(request);
  await expectEventually(page, async () => {
    await expect(page.getByText("Back soon — scheduled maintenance.")).toBeVisible();
  });
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test.describe("revalidation endpoint", () => {
  test("rejects calls without the shared secret", async ({ request }) => {
    expect((await request.post("/api/revalidate", { data: { paths: [] } })).status()).toBe(401);
    expect((await request.post("/api/revalidate", { headers: { Authorization: "Bearer nope" }, data: {} })).status()).toBe(401);
  });

  test("accepts the shared secret and validates the body", async ({ request }) => {
    const headers = { Authorization: `Bearer ${REVALIDATE_SECRET}` };

    expect((await request.post("/api/revalidate", { headers, data: { paths: ["/about-us"] } })).status()).toBe(200);
    expect((await request.post("/api/revalidate", { headers, data: { paths: "bad" } })).status()).toBe(422);
  });
});

test("a failing API produces the error page rather than cached 'not found'", async ({ page, request }) => {
  await setCmsState(request, { fail: true });
  await revalidateAll(request);

  await expect(async () => {
    await page.goto("/about-us");
    await expect(page.locator("div[role=alert]").filter({ hasText: "Something went wrong" })).toBeVisible();
  }).toPass({ timeout: 15_000 });

  await setCmsState(request, { fail: false });
  await revalidateAll(request);
  await expectEventually(page, async () => {
    await expect(page.getByRole("heading", { name: "About us" })).toBeVisible();
  });
});
