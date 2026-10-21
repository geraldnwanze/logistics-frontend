import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();

test.describe("the staff list", () => {
  test("a system administrator sees everyone with their roles and status, and filters live in the address", async ({ page, request }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");

    await expect(page.getByRole("link", { name: "Sy Sadmin (you)" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Staff" }).getByRole("listitem")).toHaveCount(9);
    await expect(page.getByRole("listitem").filter({ hasText: "Bo Bookkeeper" })).toContainText("No two-factor yet");

    await page.getByLabel("Role").selectOption({ label: "Finance officer" });
    await expect(page).toHaveURL(/role=finance-officer$/);
    await expect(page.getByRole("listitem").filter({ hasText: "Fran Finance" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alex Agent" })).toHaveCount(0);
    expect((await adminState(request)).staffQuery).toMatchObject({ role: "finance-officer" });

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByLabel("Name or email").fill("olive");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=olive$/);
    await expect(page.getByText("1 person", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name or email")).toHaveValue("olive");
  });

  test("a system administrator invites a colleague after the form checks it, and the email is already taken is explained", async ({ page, request }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.getByRole("button", { name: "Invite a colleague" }).click();
    const form = page.getByRole("form", { name: "Invite a colleague" });

    await form.getByRole("button", { name: "Review invitation" }).click();
    await expect(form.getByText("Enter their name.")).toBeVisible();
    await expect(form.getByText("Choose at least one role.")).toBeVisible();
    await expect(form.getByLabel(/Super admin/)).toBeDisabled();

    await form.getByLabel("Name").fill("Dee Dispatcher");
    await form.getByLabel("Email").fill("agent@example.test");
    await form.getByLabel("Shipping agent").check();
    await form.getByRole("button", { name: "Review invitation" }).click();
    await form.getByRole("button", { name: "Yes, send the invitation" }).click();
    await expect(form.getByRole("alert")).toContainText("An account with this email already exists.");

    await form.getByLabel("Email").fill("Dee@Example.test");
    await form.getByRole("button", { name: "Review invitation" }).click();
    await expect(form.getByRole("group", { name: "Confirm invitation" })).toContainText("Invite Dee Dispatcher (dee@example.test) as Shipping agent?");
    await form.getByRole("button", { name: "Yes, send the invitation" }).click();

    await expect(page.getByText("An invitation was sent to dee@example.test.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Dee Dispatcher" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Dee Dispatcher" })).toContainText("No two-factor yet");
    expect((await adminState(request)).log).toContain("staff-invite:dee@example.test:shipping-agent");
  });
});

test.describe("one person", () => {
  test("roles are changed after seeing exactly what changes, and what each role allows is one click away", async ({ page, request }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.getByRole("link", { name: "Alex Agent" }).click();

    const finance = page.getByLabel("Finance officer").locator("xpath=ancestor::div[1]");
    await finance.getByText("What this allows").click();
    await expect(finance).toContainText("payments view, refunds approve");
    await expect(page.getByRole("button", { name: "Review role changes" })).toBeDisabled();

    await page.getByLabel("Finance officer").check();
    await page.getByLabel("Customer support agent").uncheck();
    await page.getByRole("button", { name: "Review role changes" }).click();
    await expect(page.getByRole("group", { name: "Confirm role changes" })).toContainText("Give Alex Agent: Finance officer. Take away: Customer support agent. This takes effect straight away.");
    await page.getByRole("button", { name: "Go back" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("staff-roles"))).toEqual([]);
    await page.getByRole("button", { name: "Review role changes" }).click();
    await page.getByRole("button", { name: "Yes, save the roles" }).click();

    await expect(page.getByText("Alex Agent's roles were saved.")).toBeVisible();
    expect((await adminState(request)).log).toContain("staff-roles:agent@example.test:customer-support-agent=>finance-officer");
    await expect(page.getByText(/permissions from their roles/)).toContainText("2 permissions");
  });

  test("suspending, reactivating, password reset and two-factor reset each ask first", async ({ page, request }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.getByRole("link", { name: "Fran Finance" }).click();
    await expect(page.getByText("Two-factor on")).toBeVisible();

    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("signed out right away");
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("staff-suspend"))).toEqual([]);
    await page.getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("button", { name: "Yes, suspend" }).click();
    await expect(page.getByText("Fran Finance was suspended.")).toBeVisible();
    await expect(page.getByText("Suspended", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("button", { name: "Yes, reactivate" }).click();
    await expect(page.getByText("Fran Finance can sign in again.")).toBeVisible();

    await page.getByRole("button", { name: "Send password reset link" }).click();
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("Email finance@example.test a link");
    await page.getByRole("button", { name: "Yes, send the link" }).click();
    await expect(page.getByText("A password reset link was sent to finance@example.test.")).toBeVisible();

    await page.getByRole("button", { name: "Reset two-factor" }).click();
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("really them asking");
    await page.getByRole("button", { name: "Yes, reset two-factor" }).click();
    await expect(page.getByText("Fran Finance's two-factor was reset.")).toBeVisible();
    await expect(page.getByText("No two-factor yet").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset two-factor" })).toHaveCount(0);
    expect((await adminState(request)).log).toEqual(expect.arrayContaining(["staff-suspend:finance@example.test", "staff-reactivate:finance@example.test", "staff-reset-link:finance@example.test", "staff-2fa-reset:finance@example.test"]));
  });

  test("your own account only offers a password reset", async ({ page }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.getByRole("link", { name: "Sy Sadmin (you)" }).click();

    await expect(page.getByRole("note")).toContainText("This is your own account");
    await expect(page.getByLabel("Finance officer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send password reset link" })).toBeVisible();
    for (const name of ["Suspend", "Reset two-factor", "Review role changes"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  });

  test("an ordinary administrator can't change a super administrator, but a super administrator can, except the last", async ({ page, browser }) => {
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.getByRole("link", { name: "Ada Admin" }).click();
    await expect(page.getByRole("note")).toContainText("Only a super administrator can change a super administrator");
    await expect(page.getByRole("region", { name: "Account" })).toHaveCount(0);
    await expect(page.getByLabel("Finance officer")).toHaveCount(0);

    const other = await (await browser.newContext()).newPage();
    await signIn(other, "/admin/staff", "admin@example.test");
    await other.getByRole("link", { name: "Sy Sadmin" }).click();
    await other.getByLabel("Super admin").check();
    await other.getByRole("button", { name: "Review role changes" }).click();
    await other.getByRole("button", { name: "Yes, save the roles" }).click();
    await expect(other.getByText("Sy Sadmin's roles were saved.")).toBeVisible();

    await other.goto("/admin/staff");
    await other.getByRole("link", { name: "Sy Sadmin" }).click();
    await other.getByLabel("Super admin").uncheck();
    await other.getByRole("button", { name: "Review role changes" }).click();
    await other.getByRole("button", { name: "Yes, save the roles" }).click();
    await expect(other.getByText("Sy Sadmin's roles were saved.")).toBeVisible();
  });
});

test.describe("access", () => {
  test("people without user management are told so and have no Staff menu", async ({ page }) => {
    await signIn(page, "/admin/staff", "ops@example.test");

    await expect(page.locator("main").getByRole("alert")).toContainText("doesn't have access");
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Staff" })).toHaveCount(0);
  });

  test("staff pages work under the security policy, are never saved offline, and fit a phone", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/staff", "sysadmin@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText("9 people", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Invite a colleague" }).click();
    await expect(page.getByRole("form", { name: "Invite a colleague" })).toBeVisible();
    const overflowList = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("link", { name: "Alex Agent" }).click();
    await expect(page.getByRole("button", { name: "Review role changes" })).toBeVisible();
    const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

      return urls;
    });

    expect(overflowList).toBeLessThanOrEqual(1);
    expect(overflowDetail).toBeLessThanOrEqual(1);
    expect(cached.filter((path) => /^\/(admin|account)/.test(path))).toEqual([]);
    expect(violations).toEqual([]);
  });
});
