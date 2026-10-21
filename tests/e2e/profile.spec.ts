import { expect, test, type Page } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";

const PASSWORD = "Str0ng-Passphrase-1";
const NEW_PASSWORD = "N3w-Str0ng-Passphrase";

test.beforeEach(async ({ request }) => resetCms(request));

async function signIn(page: Page, then = "/account") {
  await page.goto(`/login?next=${encodeURIComponent(then)}`);
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${then.replace(/\//g, "\\/")}$`));
}

test("signed-out visitors are sent to sign in and come straight back", async ({ page }) => {
  await page.goto("/account/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fprofile$/);

  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(page.getByLabel("Full name")).toHaveValue("Ada Shipper");
});

test("the account pages link to each other and mark where you are", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Password" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("changing preferences saves only what changed and survives a reload", async ({ page, request }) => {
  await signIn(page, "/account/profile");
  await expect(page.getByRole("option", { name: "French (fr)" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await page.getByLabel("Full name").fill("Ada Obi");
  await page.getByLabel("Phone").fill("+234 801 000 0000");
  await page.getByLabel("Language").selectOption("fr");
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByLabel("Time zone").selectOption("Africa/Lagos");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status")).toContainText("Your changes have been saved.");
  expect((await (await request.get(`${STUB_URL}/__last-patch`)).json()).patch).toEqual({
    name: "Ada Obi", phone: "+234 801 000 0000", locale: "fr", timezone: "Africa/Lagos", preferred_currency: "EUR",
  });

  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Ada Obi");
  await expect(page.getByLabel("Language")).toHaveValue("fr");
  await expect(page.getByLabel("Currency")).toHaveValue("EUR");
  await expect(page.getByLabel("Time zone")).toHaveValue("Africa/Lagos");

  await page.getByLabel("Phone").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect((await (await request.get(`${STUB_URL}/__last-patch`)).json()).patch).toEqual({ phone: null });
});

test("an empty name is caught before anything is sent", async ({ page }) => {
  await signIn(page, "/account/profile");

  await page.getByLabel("Full name").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Enter your name.")).toBeVisible();
});

test("the overview page shows the new name after saving", async ({ page }) => {
  await signIn(page, "/account/profile");
  await page.getByLabel("Full name").fill("Ada Obi");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByRole("link", { name: "Overview" }).click();

  await expect(page.getByText("Ada Obi")).toBeVisible();
});

test("changing the password needs the current one and explains refusals", async ({ page }) => {
  await signIn(page, "/account/password");

  await page.getByLabel("Current password").fill("not-the-password-Aa1");
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The password is incorrect.")).toBeVisible();

  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill("Password12345");
  await page.getByLabel("Confirm new password").fill("Password12345");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/appeared in a data leak/)).toBeVisible();
});

test("a changed password works for the next sign-in and the old one stops working", async ({ page }) => {
  await signIn(page, "/account/password");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.getByRole("status")).toContainText("Your password has been changed");
  await expect(page.getByLabel("Current password")).toHaveValue("");

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("don't match");

  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("downloads a copy of the person's data", async ({ page }) => {
  await signIn(page, "/account/profile");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my data" }).click()]);

  expect(download.suggestedFilename()).toBe("my-data.json");
  const contents = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
  expect(contents.user.email).toBe("ada@example.test");
});

test("requesting account deletion asks first, and is remembered after a reload", async ({ page }) => {
  await signIn(page, "/account/profile");

  await page.getByRole("button", { name: "Request account deletion" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Request account deletion" })).toBeVisible();

  await page.getByRole("button", { name: "Request account deletion" }).click();
  await page.getByRole("button", { name: "Yes, request deletion" }).click();
  await expect(page.getByRole("status").filter({ hasText: "recorded" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "request has been recorded" })).toBeVisible();
});

test("account pages are kept out of search and the offline cache, and work under the security policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await signIn(page, "/account/profile");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goto("/account/password");
  await expect(page.getByLabel("Current password")).toBeVisible();

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(cached.filter((path) => path.startsWith("/account"))).toEqual([]);
  expect(violations).toEqual([]);
});
