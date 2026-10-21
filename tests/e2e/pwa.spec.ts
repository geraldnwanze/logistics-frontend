import { expect, test } from "@playwright/test";
import { resetCms } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("serves an installable manifest with real icons", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();

  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
  expect(manifest.name).toBeTruthy();
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`)).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));

  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});

test("never lets the browser cache the service worker", async ({ request }) => {
  const worker = await request.get("/sw.js");

  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
});

test("pages already visited open offline, and anything else shows the offline page", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    return registration.active?.state;
  });
  await page.goto("/track"); // visited while online, so saved by the worker
  await page.goto("/");

  await context.setOffline(true);

  await page.goto("/track");
  await expect(page.getByRole("heading", { name: /track/i }).first()).toBeVisible();
  await expect(page.getByRole("status")).toContainText("You are offline");

  await page.goto("/never-visited-page");
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();

  await context.setOffline(false);
});

test("the API and preview are never served from the worker's cache", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto("/track");

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((path) => /^\/(api|preview|admin|account)/.test(path))).toEqual([]);
  expect(cached).toContain("/offline.html");
});
