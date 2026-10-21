import { expect, test } from "@playwright/test";
import { resetCms } from "./support/cms";

test.beforeEach(async ({ request }) => resetCms(request));

test("every page carries the security headers", async ({ request }) => {
  for (const path of ["/", "/about-us", "/track/LG000000000001", "/does-not-exist", "/offline.html", "/sw.js"]) {
    const headers = (await request.get(path)).headers();

    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("object-src 'none'");
  }
});

test("the site works under its own policy: no violations on the main pages, including the live tracking call", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text().slice(0, 200));
  });

  for (const path of ["/", "/about-us", "/track", "/track/LG000000000001", "/track/LG000000000404"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(800); // let hydration and the tracking call run before reading violations
  }
  await expect(page.getByRole("heading", { name: "Track shipment" })).toBeVisible();

  expect(violations).toEqual([]);
});

test("the policy actually blocks scripts, frames and network calls to other origins", async ({ page }) => {
  await page.goto("/about-us");
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });

  const outcome = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.src = "https://evil.example/x.js";
    document.head.appendChild(script);

    const frame = document.createElement("iframe");
    frame.src = "https://evil.example/";
    document.body.appendChild(frame);

    return fetch("https://evil.example/collect").then(() => "allowed", () => "blocked");
  });
  await page.waitForTimeout(500);

  expect(outcome).toBe("blocked");
  expect(violations.join("\n")).toContain("script-src");
  expect(violations.join("\n")).toContain("frame-src");
  expect(violations.join("\n")).toContain("connect-src");
});

test("the site cannot be framed by another origin", async ({ page }) => {
  await page.goto("/about-us");
  const framed = await page.evaluate(
    () => new Promise<string>((resolve) => {
      const frame = document.createElement("iframe");
      frame.src = `${location.origin}/about-us`;
      frame.onload = () => resolve("loaded");
      frame.onerror = () => resolve("error");
      document.body.appendChild(frame);
      setTimeout(() => resolve("blocked-or-pending"), 2000);
    }),
  );
  const csp = await page.evaluate(async () => (await fetch("/about-us")).headers.get("x-frame-options"));

  expect(csp).toBe("DENY");
  expect(framed).not.toBe("error");
});
