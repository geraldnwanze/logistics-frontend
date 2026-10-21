import { expect, test, type Page } from "@playwright/test";
import { resetCms } from "./support/cms";

const PASSWORD = "Str0ng-Passphrase-1";

test.beforeEach(async ({ request }) => resetCms(request));

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a customer signs in with email and password and lands on the account page", async ({ page }) => {
  await signIn(page, "ada@example.test");

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Ada Shipper")).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
});

test("wrong credentials are explained and nobody is signed in", async ({ page }) => {
  await signIn(page, "ada@example.test", "wrong-password");

  await expect(page.locator("main").getByRole("alert")).toContainText("don't match");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("a suspended account and a throttled one get clear messages", async ({ page }) => {
  await signIn(page, "suspended@example.test");
  await expect(page.locator("main").getByRole("alert")).toContainText("suspended");

  await page.reload();
  await signIn(page, "throttled@example.test", "anything");
  await expect(page.locator("main").getByRole("alert")).toContainText("Too many attempts");
});

test("staff must give an authenticator code before they are signed in", async ({ page }) => {
  await signIn(page, "staff@example.test");

  const code = page.getByLabel("Authentication code");
  await expect(code).toBeVisible();
  await expect(code).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Password")).toHaveCount(0);

  await page.goto("/account"); // not signed in yet: the account page sends them back
  await expect(page).toHaveURL(/\/login\?next=\/account$/);
});

test("the code step accepts the right code, rejects a wrong one, and offers recovery codes", async ({ page }) => {
  await signIn(page, "staff@example.test");

  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("That code isn't correct");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill("aaaaa-bbbbb");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Sam Staff")).toBeVisible();
});

test("five wrong codes send the person back to the password step", async ({ page }) => {
  await signIn(page, "staff@example.test");

  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByLabel("Authentication code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    if (attempt < 4) await expect(page.locator("main").getByRole("alert")).toContainText("isn't correct");
  }

  await expect(page.locator("main").getByRole("alert")).toContainText("Too many incorrect codes");
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("visiting the account page signed out sends you to sign in and back afterwards", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=\/account$/);

  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("a link that points off-site is never followed after sign-in", async ({ page }) => {
  await page.goto("/login?next=https://evil.example/phish");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});

test("signing out ends the session and wipes saved tracking from the device", async ({ page }) => {
  await page.goto("/track/LG000000000001");
  await expect(page.getByRole("heading", { name: "In transit", level: 2 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tracking:saved:v1"))).not.toBeNull();

  await signIn(page, "ada@example.test");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("tracking:saved:v1"))).toBeNull();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=\/account$/);
});

test("registration creates and signs in an account, and shows the API's complaints beside the field", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("The email has already been taken.")).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);

  await page.getByLabel("Email").fill("grace@example.test");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  await expect(page.getByText("isn't verified yet")).toBeVisible();
});

test("registration catches a weak password before anything is sent", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("grace@example.test");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test("forgotten password: same confirmation, then a reset through the emailed link", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists for nobody@example.test");

  await page.goto("/reset-password?token=good-token&email=ada%40example.test");
  await expect(page).toHaveURL(/\/reset-password$/); // token removed from the address bar
  await page.getByLabel("New password", { exact: true }).fill("Another-Str0ng-Passphrase");
  await page.getByLabel("Confirm new password").fill("Another-Str0ng-Passphrase");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been changed");
});

test("an expired reset link says so", async ({ page }) => {
  await page.goto("/reset-password?token=stale&email=ada%40example.test");
  await page.getByLabel("New password", { exact: true }).fill("Another-Str0ng-Passphrase");
  await page.getByLabel("Confirm new password").fill("Another-Str0ng-Passphrase");
  await page.getByRole("button", { name: "Change password" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText("invalid or has expired");
});

test("a customer turns two-factor on, saves recovery codes, then turns it off", async ({ page }) => {
  await signIn(page, "ada@example.test");
  await expect(page.getByText("Status: Off")).toBeVisible();

  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("setup-key")).toHaveText("JBSW Y3DP EHPK 3PXP");
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("isn't correct");

  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByTestId("recovery-codes").getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: /I've saved my codes/ }).click();
  await expect(page.getByText("Status: On")).toBeVisible();
  await expect(page.getByText("Recovery codes left:")).toContainText("10");

  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  const panel = page.getByRole("region", { name: "Two-factor authentication" });
  await panel.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await panel.getByLabel("6-digit code").fill("123456");
  await panel.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(page.getByText("Status: Off")).toBeVisible();
});

test("the landing page after the emailed verification link exists", async ({ page }) => {
  await page.goto("/email-verified");

  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your account" }).click();
  await expect(page).toHaveURL(/\/(account|login\?next=\/account)$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("account, sign-in and reset pages are never saved by the offline worker", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await signIn(page, "ada@example.test");
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/reset-password?token=good-token&email=ada%40example.test");

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname + new URL(key.url).search);

    return urls;
  });

  expect(cached.filter((path) => /^\/(login|account|register|forgot-password|reset-password)/.test(path) || path.includes("token="))).toEqual([]);
});

test("the sign-in screens work with the site's security policy: no violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text().slice(0, 200));
  });

  await signIn(page, "staff@example.test");
  await page.getByLabel("Authentication code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Sam Staff")).toBeVisible();

  expect(violations).toEqual([]);
});
