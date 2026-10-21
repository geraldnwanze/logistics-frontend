import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { post, seed, signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminSeed = (request: APIRequestContext, data: Record<string, unknown>) => post(request, "/__admin-seed", data);
const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();
const past = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

const TICKETS = [
  { subject: "Parcel never arrived", priority: "urgent", status: "pending_staff", category: "shipment", first_response_due_at: past(2) },
  { subject: "Invoice looks wrong", priority: "normal", status: "pending_staff", category: "billing", owner: "ada" },
  { subject: "Customs paperwork", priority: "low", status: "pending_customer", category: "customs", first_response_at: past(1) },
];

test.describe("tickets", () => {
  test("an agent sees what needs attention first and narrows the queue with filters kept in the address", async ({ page, request }) => {
    await adminSeed(request, { tickets: TICKETS });
    await signIn(page, "/admin", "agent@example.test");

    const tile = page.getByRole("link", { name: /Tickets waiting for our reply/ });
    await expect(tile).toContainText("2");
    await expect(page.getByRole("link", { name: /First reply overdue/ })).toContainText("1");
    await tile.click();

    await expect(page).toHaveURL(/\/admin\/tickets\?status=pending_staff$/);
    const rows = page.getByRole("list").filter({ has: page.getByRole("link", { name: "Parcel never arrived" }) }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Parcel never arrived");   // urgent comes first
    await expect(rows.first()).toContainText("Overdue");
    await expect(rows.nth(1)).toContainText("Ada Shipper");

    await page.getByLabel("Category").selectOption("billing");
    await expect(page).toHaveURL(/status=pending_staff&category=billing$/);
    await expect(page.getByRole("link", { name: "Invoice looks wrong" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Parcel never arrived" })).toHaveCount(0);

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByRole("link", { name: "Customs paperwork" })).toBeVisible();
    await page.getByLabel("Search").fill("customs");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=customs$/);
    await expect(page.getByText("1 ticket", { exact: true })).toBeVisible();
    expect((await adminState(request)).ticketQuery).toMatchObject({ q: "customs" });

    await page.reload();
    await expect(page.getByLabel("Search")).toHaveValue("customs");
  });

  test("an agent takes a ticket, leaves a private note, answers the customer, and the customer sees only the answer", async ({ page, browser, request }) => {
    await page.goto("/support");
    await page.getByLabel("Subject").fill("Where is my parcel?");
    await page.getByLabel("How can we help?").fill("It has not moved for three days.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);

    const staffContext = await browser.newContext();
    const agent = await staffContext.newPage();
    await signIn(agent, "/admin/tickets", "agent@example.test");
    await agent.getByRole("link", { name: "Where is my parcel?" }).click();
    await expect(agent.getByText("It has not moved for three days.")).toBeVisible();
    await expect(agent.getByRole("link", { name: "guest@example.test" })).toBeVisible();

    await agent.getByRole("button", { name: "Assign to me" }).click();
    await expect(agent.getByText("You are handling this.")).toBeVisible();
    await agent.getByRole("region", { name: "Handling" }).getByLabel("Priority").selectOption("high");
    await expect(agent.getByText("Priority updated.")).toBeVisible();

    await agent.getByLabel("Reply to the customer").fill("Customer has written twice already.");
    await agent.getByLabel(/Internal note only/).check();
    await agent.getByRole("button", { name: "Add note" }).click();
    await expect(agent.getByText("Internal note, not visible to the customer")).toBeVisible();

    await expect(agent.getByLabel(/Internal note only/)).not.toBeChecked();
    await agent.getByLabel("Reply to the customer").fill("We are chasing the carrier and will update you today.");
    await agent.getByRole("button", { name: "Send reply" }).click();
    await expect(agent.getByText("Reply sent.")).toBeVisible();
    await expect(agent.getByText("Waiting for customer", { exact: true }).first()).toBeVisible();
    expect((await adminState(request)).log).toEqual(expect.arrayContaining(["update:T1:{\"assigned_to\":\"01HAGENT000000000000000000\"}", "reply:T1:internal:", "reply:T1:public:pending_customer"]));

    await page.reload();
    await expect(page.getByText("We are chasing the carrier and will update you today.")).toBeVisible();
    await expect(page.getByText("Waiting for your reply")).toBeVisible();
    await expect(page.getByText("written twice")).toHaveCount(0);
    await staffContext.close();
  });

  test("a ticket someone else is handling can be taken over, and a closed one takes no reply", async ({ page, request }) => {
    await adminSeed(request, { tickets: [{ subject: "Held by a colleague", assigned_to: "01HBEA00000000000000000000" }, { subject: "Done already", status: "closed" }] });
    await signIn(page, "/admin/tickets", "agent@example.test");

    await page.getByRole("link", { name: "Held by a colleague" }).click();
    await expect(page.getByText("Bea Booker is handling this.")).toBeVisible();
    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByText("You are handling this.")).toBeVisible();

    await page.goto("/admin/tickets");
    await page.getByRole("link", { name: "Done already" }).click();
    await expect(page.getByText(/This ticket is closed/)).toBeVisible();
    await expect(page.getByLabel("Reply to the customer")).toHaveCount(0);
  });

  test("an agent hands a ticket to a colleague, and the queue can be filtered by that colleague", async ({ page, request }) => {
    await adminSeed(request, { tickets: [{ subject: "Needs the customs desk" }, { subject: "Someone else's problem", assigned_to: "01HCAL00000000000000000000" }] });
    await signIn(page, "/admin/tickets", "agent@example.test");
    await page.getByRole("link", { name: "Needs the customs desk" }).click();

    const select = page.getByRole("region", { name: "Handling" }).getByLabel("Assigned to");
    await expect(select.getByRole("option")).toHaveText(["Nobody", "Alex Agent (you)", "Bea Booker", "Cal Carter"]);
    await select.selectOption({ label: "Bea Booker" });
    await expect(page.getByText("Assigned to Bea Booker.")).toBeVisible();
    await expect(page.getByText("Bea Booker is handling this.")).toBeVisible();
    expect((await adminState(request)).log).toContain(`update:T1:{"assigned_to":"01HBEA00000000000000000000"}`);

    await page.goto("/admin/tickets");
    await expect(page.getByRole("link", { name: "Needs the customs desk" }).locator("xpath=ancestor::li")).toContainText("Handled by Bea Booker");
    await page.getByRole("combobox", { name: "Assigned to" }).selectOption({ label: "Bea Booker" });
    await expect(page).toHaveURL(/assigned_to=01HBEA00000000000000000000$/);
    await expect(page.getByRole("link", { name: "Needs the customs desk" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Someone else's problem" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Assigned to" })).toHaveValue("01HBEA00000000000000000000");
  });

  test("ticket text is shown as text, never as markup", async ({ page, request }) => {
    await adminSeed(request, { tickets: [{ subject: "<b>bold?</b>", messages: [{ from: "customer", body: "<img src=x onerror=alert(1)>", created_at: past(1), attachments: [] }] }] });
    await signIn(page, "/admin/tickets", "agent@example.test");
    await page.getByRole("link", { name: "<b>bold?</b>" }).click();

    await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
  });
});

test.describe("claims", () => {
  const CLAIMS = [{ claimed_minor: 2000 }, { claimed_minor: 5000, type: "loss", status: "approved", approved: { amount_minor: 4000, amount: "40.00", currency: "USD" } }];

  test("an agent reviews a claim and asks the customer for more, but cannot decide or pay", async ({ page, request }) => {
    await adminSeed(request, { claims: CLAIMS });
    await signIn(page, "/admin/claims", "agent@example.test");
    await expect(page.getByRole("link", { name: /Damaged goods/ })).toBeVisible();

    await page.getByRole("link", { name: /Damaged goods/ }).click();
    await expect(page.getByRole("heading", { name: /Damaged goods · \$20\.00/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decision" })).toHaveCount(0);

    await page.getByLabel("Internal note").fill("Photos look genuine.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Internal note, not visible to the customer")).toBeVisible();

    await page.getByLabel("Ask the customer for more information").fill("Please send the receipt.");
    await page.getByRole("button", { name: "Ask the customer" }).click();
    await expect(page.getByText("Asked the customer for more information.")).toBeVisible();
    await expect(page.getByText("Waiting for the customer to reply.")).toBeVisible();

    await page.goto("/admin/claims");
    await page.getByRole("link", { name: /Lost shipment/ }).click();
    await expect(page.getByRole("heading", { name: "Pay out" })).toHaveCount(0);
  });

  test("a finance officer approves part of a claim after confirming, then pays it once", async ({ page, request }) => {
    await adminSeed(request, { claims: CLAIMS });
    await signIn(page, "/admin/claims?status=submitted", "finance@example.test");
    await page.getByRole("link", { name: /Damaged goods/ }).click();

    const amount = page.getByLabel("Amount to approve (USD)");
    await expect(amount).toHaveValue("20.00");
    await amount.fill("25.00");
    await expect(page.getByText(/The most you can approve is \$20\.00/)).toBeVisible();
    await amount.fill("12.50");
    await page.getByLabel(/Reason/).fill("Partly covered by the carrier's terms.");
    await page.getByRole("button", { name: "Review decision" }).click();
    await expect(page.getByRole("group", { name: "Confirm decision" })).toContainText("Approve $12.50?");
    await page.getByRole("button", { name: "Go back" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("decision"))).toEqual([]);
    await page.getByRole("button", { name: "Review decision" }).click();
    await page.getByRole("button", { name: "Yes, approve" }).click();

    await expect(page.getByText("Claim approved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pay out" })).toBeVisible();
    await expect(page.getByText(/To pay: \$12\.50/)).toBeVisible();
    await page.getByLabel("How to pay").selectOption("manual");
    await page.getByLabel("Payment reference").fill("BANK-778");
    await page.getByRole("button", { name: "Review payout" }).click();
    await page.getByRole("button", { name: "Yes, pay out" }).click();

    await expect(page.getByText("Payout recorded.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pay out" })).toHaveCount(0);
    expect((await adminState(request)).log).toEqual(expect.arrayContaining(["decision:C1:approve:12.50", "payout:C1:manual:BANK-778"]));

    await page.goto("/admin/claims");
    await expect(page.getByRole("link", { name: /Damaged goods/ }).locator("xpath=ancestor::li")).toContainText("Paid");
  });

  test("a rejection needs a reason the customer will read", async ({ page, request }) => {
    await adminSeed(request, { claims: CLAIMS });
    await signIn(page, "/admin/claims", "finance@example.test");
    await page.getByRole("link", { name: /Damaged goods/ }).click();

    await page.getByLabel("Reject").check();
    await expect(page.getByLabel("Amount to approve (USD)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review decision" })).toBeDisabled();
    await page.getByLabel(/Reason/).fill("Outside the claim window.");
    await page.getByRole("button", { name: "Review decision" }).click();
    await page.getByRole("button", { name: "Yes, reject" }).click();

    await expect(page.getByText("Claim rejected.")).toBeVisible();
    await expect(page.getByText(/Outside the claim window\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decision" })).toHaveCount(0);
  });
});

test.describe("access", () => {
  test("signed-out visitors are sent to sign in and come back", async ({ page }) => {
    await page.goto("/admin/claims");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fclaims$/);
  });

  test("a customer is told they have no access and the back-office API is never called", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/v1/admin/")) calls.push(r.url()); });
    await signIn(page, "/admin/tickets");

    await expect(page.locator("main").getByRole("alert")).toContainText("doesn't have access");
    await expect(page.getByRole("link", { name: "Support tickets" })).toHaveCount(0);
    expect(calls).toEqual([]);
    await page.goto("/account");
    await expect(page.getByRole("link", { name: "Back office" })).toHaveCount(0);
  });

  test("staff find the back office from their account page", async ({ page }) => {
    await signIn(page, "/account", "agent@example.test");

    await page.getByRole("link", { name: "Back office" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Claims" })).toBeVisible();
  });

  test("a staff member who hasn't set up two-factor is pointed to the place to do it", async ({ page }) => {
    await signIn(page, "/admin/tickets", "unenrolled@example.test");

    await expect(page.locator("main").getByRole("alert")).toContainText("Set up two-factor authentication");
    await expect(page.getByRole("link", { name: "Set it up in your account" })).toHaveAttribute("href", "/account");
  });

  test("back-office pages work under the security policy, are never saved offline, and fit a phone", async ({ page, browser, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await adminSeed(request, { tickets: TICKETS, claims: [{ claimed_minor: 2000 }] });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/tickets", "agent@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("link", { name: "Parcel never arrived" })).toBeVisible();
    await page.getByRole("link", { name: "Parcel never arrived" }).click();
    await expect(page.getByRole("button", { name: "Send reply" })).toBeVisible();
    const overflowTicket = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    const finance = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
    finance.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await signIn(finance, "/admin/claims", "finance@example.test");
    await finance.getByRole("link", { name: /Damaged goods/ }).click();
    await expect(finance.getByRole("heading", { name: "Decision" })).toBeVisible();
    const overflowClaim = await finance.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

      return urls;
    });

    expect(overflowTicket).toBeLessThanOrEqual(1);
    expect(overflowClaim).toBeLessThanOrEqual(1);
    expect(cached.filter((path) => /^\/(admin|account|support|claims)/.test(path))).toEqual([]);
    expect(violations).toEqual([]);
  });
});

test.describe("staff attachments", () => {
  const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048)]) });
  const attach = (page: Page, files: ReturnType<typeof pdf>[]) => page.getByTestId("attachment-input").setInputFiles(files);

  async function guestTicket(page: Page) {
    await page.goto("/support");
    await page.getByLabel("Subject").fill("Need the customs form");
    await page.getByLabel("How can we help?").fill("Which form do I fill in?");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);
  }

  test("an agent sends a form with a reply, the customer downloads it, and a private file stays private", async ({ page, browser }) => {
    await guestTicket(page);
    const agent = await (await browser.newContext()).newPage();
    await signIn(agent, "/admin/tickets", "agent@example.test");
    await agent.getByRole("link", { name: "Need the customs form" }).click();

    await attach(agent, [pdf("customs-form.pdf")]);
    await expect(agent.getByText("The customer will be able to download these.")).toBeVisible();
    await agent.getByLabel("Reply to the customer").fill("Please fill in the attached form.");
    await agent.getByRole("button", { name: "Send reply" }).click();
    await expect(agent.getByText("Reply sent.")).toBeVisible();
    await expect(agent.getByRole("list", { name: "Files to send" })).toHaveCount(0);
    await expect(agent.getByRole("list", { name: "Messages" }).getByRole("button", { name: "Download customs-form.pdf" })).toBeVisible();

    await agent.getByLabel(/Internal note only/).check();
    await expect(agent.getByText("Files on a private note are only visible to staff.")).toBeVisible();
    await attach(agent, [pdf("risk-notes.pdf")]);
    await agent.getByRole("textbox", { name: "Internal note" }).fill("Risk review attached.");
    await agent.getByRole("button", { name: "Add note" }).click();
    await expect(agent.getByRole("button", { name: "Download risk-notes.pdf" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Download customs-form.pdf" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download risk-notes.pdf" })).toHaveCount(0);
    expect(await page.content()).not.toContain("risk-notes");
    const link = page.waitForRequest((r) => /support\/tickets\/T1\/attachments\/\w+$/.test(r.url()));
    await page.getByRole("button", { name: "Download customs-form.pdf" }).click();
    expect((await link).headers()["x-ticket-token"]).toBe("ticket-token-T1");
  });

  test("a file that only pretends to be a PDF is refused and the reply is kept for fixing", async ({ page, browser }) => {
    await guestTicket(page);
    const agent = await (await browser.newContext()).newPage();
    await signIn(agent, "/admin/tickets", "agent@example.test");
    await agent.getByRole("link", { name: "Need the customs form" }).click();

    await agent.getByLabel("Reply to the customer").fill("See attached.");
    await attach(agent, [{ name: "form.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is a program") }]);
    await agent.getByRole("button", { name: "Send reply" }).click();

    await expect(agent.locator("main").getByRole("alert")).toContainText("“form.pdf” isn't a PDF, JPEG or PNG file.");
    await expect(agent.getByLabel("Reply to the customer")).toHaveValue("See attached.");
    await agent.getByRole("button", { name: "Remove form.pdf" }).click();
    await agent.getByRole("button", { name: "Send reply" }).click();
    await expect(agent.getByText("Reply sent.")).toBeVisible();
  });

  test("an agent attaches a form to a message on a claim, and the customer can download it", async ({ page, browser, request }) => {
    await seed(request, [{ tracking: "LG000000000941", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000941" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);

    const agent = await (await browser.newContext()).newPage();
    await signIn(agent, "/admin/claims", "agent@example.test");
    await agent.getByRole("link", { name: /Damaged goods/ }).click();
    await agent.getByLabel("Show this to the customer").check();
    await agent.getByLabel("Message to the customer").fill("Please complete and return this form.");
    await attach(agent, [pdf("claim-form.pdf")]);
    await agent.getByRole("button", { name: "Send to customer" }).click();
    await expect(agent.getByText("Message sent to the customer.")).toBeVisible();
    await expect(agent.getByRole("button", { name: "Download claim-form.pdf" })).toBeVisible();

    await agent.getByLabel("Show this to the customer").uncheck();
    await agent.getByRole("textbox", { name: "Internal note" }).fill("Secret analysis.");
    await attach(agent, [pdf("analysis.pdf")]);
    await agent.getByRole("button", { name: "Add note" }).click();
    await expect(agent.getByRole("button", { name: "Download analysis.pdf" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Download claim-form.pdf" })).toBeVisible();
    await expect(page.getByText("analysis.pdf")).toHaveCount(0);
    const link = page.waitForRequest((r) => /claims\/C1\/attachments\/\w+$/.test(r.url()));
    await page.getByRole("button", { name: "Download claim-form.pdf" }).click();
    await link;
  });
});

test.describe("full page loads", () => {
  test("a back-office detail page loaded or reloaded while signed in hydrates cleanly", async ({ page, request }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message.slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) problems.push(m.text().slice(0, 200)); });
    await adminSeed(request, { tickets: TICKETS });
    await signIn(page, "/admin/tickets", "agent@example.test");
    await page.getByRole("link", { name: "Parcel never arrived" }).click();
    await expect(page.getByRole("button", { name: "Send reply" })).toBeVisible();

    for (let n = 0; n < 3; n++) {
      await page.reload();
      await expect(page.getByRole("button", { name: "Send reply" })).toBeVisible();
      await page.waitForTimeout(600);
    }

    expect(problems).toEqual([]);
  });
});
