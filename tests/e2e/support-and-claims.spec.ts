import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms, setCmsState } from "./support/cms";
import { bookAsGuest, post, seed, signIn, stubState } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const shopDefaults = { quotes: {}, shipments: {}, idempotency: {}, created: 0, payments: {}, sandboxOff: false, paymentDown: false, confirmDelay: 0, tickets: {}, claims: {} };
const setPageSize = (request: APIRequestContext, pageSize: number) => setCmsState(request, { shop: { ...shopDefaults, pageSize } });

test.describe("support tickets", () => {
  test("a guest writes to support, follows the conversation in the same tab, and replies", async ({ page, request }) => {
    await page.goto("/support");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Subject")).toHaveAccessibleDescription(/Tell us briefly/);
    await expect(page.getByLabel("Your email")).toHaveAccessibleDescription(/Enter an email address/);

    await page.getByLabel("Subject").fill("Where is my parcel?");
    await page.getByLabel("How can we help?").fill("It has not moved for three days.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);
    expect(page.url()).not.toContain("token");
    await expect(page.getByRole("heading", { name: "Where is my parcel?" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Messages" }).getByText("It has not moved for three days.")).toBeVisible();
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("ticket-token:")).length)).toBe(1);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("ticket-token");

    await post(request, "/__ticket", { id: "T1", staffReply: "We're chasing the carrier.", status: "pending_customer" });
    await page.reload();
    await expect(page.getByText("We're chasing the carrier.")).toBeVisible();
    await expect(page.getByText("Waiting for your reply")).toBeVisible();
    await expect(page.getByText("Support team")).toBeVisible();

    await page.getByLabel("Your reply").fill("Thank you, any update today?");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Thank you, any update today?")).toBeVisible();
    await expect(page.getByText("Waiting for our team")).toBeVisible();
  });

  test("closing a ticket asks first, and a closed ticket takes no replies", async ({ page }) => {
    await page.goto("/support");
    await page.getByLabel("Subject").fill("Question");
    await page.getByLabel("How can we help?").fill("A quick question.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/tickets\//);

    await page.getByRole("button", { name: "Close this ticket" }).click();
    await page.getByRole("button", { name: "Keep open" }).click();
    await expect(page.getByLabel("Your reply")).toBeVisible();
    await page.getByRole("button", { name: "Close this ticket" }).click();
    await page.getByRole("button", { name: "Yes, close it" }).click();

    await expect(page.getByText(/This ticket is closed/)).toBeVisible();
    await expect(page.getByLabel("Your reply")).toHaveCount(0);
  });

  test("another browser can't read a guest's conversation", async ({ page, browser }) => {
    await page.goto("/support");
    await page.getByLabel("Subject").fill("Private");
    await page.getByLabel("How can we help?").fill("Some details.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);

    const stranger = await browser.newPage();
    await stranger.goto(page.url());
    await expect(stranger.locator("main").getByRole("alert")).toContainText("same browser tab");
    await stranger.close();
  });

  test("message text is shown as text, never as markup", async ({ page }) => {
    await page.goto("/support");
    await page.getByLabel("Subject").fill("<b>bold?</b>");
    await page.getByLabel("How can we help?").fill("<img src=x onerror=alert(1)>");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("from a shipment, support starts with the shipment filled in, and the ticket joins the account's list", async ({ page, request }) => {
    await setPageSize(request, 2);
    await seed(request, [{ tracking: "LG000000000801", status: "in_transit", label: "In transit", cancellable: false }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000801" }).click();
    await page.getByRole("link", { name: "Contact support" }).click();

    await expect(page.getByLabel("What is this about?")).toHaveValue("shipment");
    await expect(page.getByLabel(/Tracking number/)).toHaveValue("LG000000000801");
    await expect(page.getByLabel("Your email")).toHaveCount(0);
    for (const subject of ["First", "Second", "Third"]) {
      await page.goto("/support?shipment=LG000000000801");
      await page.getByLabel("Subject").fill(subject);
      await page.getByLabel("How can we help?").fill("Details.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "LG000000000801" })).toBeVisible();

    await page.goto("/account/support");
    await expect(page.getByRole("link", { name: "Third" })).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByRole("link", { name: "First" })).toBeVisible();
  });

  test("a tracking number that isn't theirs is refused without saying whether it exists", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000802" }]);
    await page.goto("/support?shipment=LG000000000802");
    await page.getByLabel("Subject").fill("Not mine");
    await page.getByLabel("How can we help?").fill("Details.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("We could not find that shipment on your account.")).toBeVisible();
    await expect(page).toHaveURL(/\/support/);
  });

  test("a guest can raise a ticket about their own shipment", async ({ page }) => {
    await bookAsGuest(page);
    await page.getByRole("link", { name: "Contact support" }).click();
    await expect(page.getByLabel(/Tracking number/)).toHaveValue(/^LG\d+/);
    await page.getByLabel("Subject").fill("About my booking");
    await page.getByLabel("How can we help?").fill("Details.");
    await page.getByLabel("Your email").fill("guest@example.test");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("heading", { name: "About my booking" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^LG\d+/ })).toBeVisible();
  });
});

test.describe("claims", () => {
  test("a customer files a claim on a delivered shipment and follows it to a decision", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000901", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000901" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();

    await expect(page.getByLabel("Damaged goods")).toBeChecked();
    await expect(page.getByLabel("Lost shipment")).toBeDisabled();
    await expect(page.getByLabel("Lost shipment")).toHaveAccessibleDescription("A delivered shipment cannot be claimed as lost.");
    await expect(page.getByLabel("Late delivery")).toBeDisabled();
    await expect(page.getByText(/covered for up to/)).toContainText("70.41");

    await page.getByLabel(/Amount you are claiming/).fill("500");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page.getByLabel(/Amount you are claiming/)).toHaveAccessibleDescription(/most this shipment is covered for is .*70\.41/);

    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);
    await expect(page.getByRole("heading", { name: "Damaged goods" })).toBeVisible();
    await expect(page.getByText("We've received your claim and will review it.")).toBeVisible();
    expect((await stubState(request)).lastClaim).toMatchObject({ type: "damage", claimed_amount: "20.00" });

    await post(request, "/__claim", { id: "C1", status: "info_requested", staffNote: "Please send a photo of the box." });
    await page.reload();
    await expect(page.getByText(/read our message below/)).toBeVisible();
    await expect(page.getByText("Please send a photo of the box.")).toBeVisible();
    await page.getByLabel("Your reply").fill("The box is visible in my photo, sent by email.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("The box is visible in my photo, sent by email.")).toBeVisible();
    await expect(page.getByText("Under review", { exact: true })).toBeVisible();

    await post(request, "/__claim", { id: "C1", status: "approved", approved_minor: 1500, resolution_note: "Approved for the damaged books." });
    await page.reload();
    await expect(page.getByText("Approved for the damaged books.")).toBeVisible();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

    await post(request, "/__claim", { id: "C1", status: "paid" });
    await page.reload();
    await expect(page.getByLabel(/Add a message|Your reply/)).toHaveCount(0);

    await page.goto("/account/claims");
    const row = page.getByRole("link", { name: "Damaged goods" }).locator("xpath=ancestor::li");
    await expect(row).toContainText("CLM-2026-000001");
    await expect(row).toContainText("Paid");
  });

  test("a customer can withdraw an undecided claim, and then file that type again", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000921", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000921" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);

    await page.getByRole("button", { name: "Withdraw this claim" }).click();
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByLabel("Add a message")).toBeVisible();
    await page.getByRole("button", { name: "Withdraw this claim" }).click();
    await page.getByRole("button", { name: "Yes, withdraw it" }).click();

    await expect(page.getByText("You withdrew this claim.")).toBeVisible();
    await expect(page.getByLabel("Add a message")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Withdraw this claim" })).toHaveCount(0);

    await page.goto("/account/claims");
    await expect(page.getByRole("link", { name: "Damaged goods" }).locator("xpath=ancestor::li")).toContainText("Withdrawn");

    await page.goto("/account/shipments");
    await page.getByRole("link", { name: "LG000000000921" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await expect(page.getByLabel("Damaged goods")).toBeEnabled();
  });

  test("a claim that has been decided can't be withdrawn", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000922", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000922" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);

    await post(request, "/__claim", { id: "C1", status: "approved", approved_minor: 1500, resolution_note: "Approved." });
    await page.reload();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw this claim" })).toHaveCount(0);
  });

  test("once a claim is open, that type can't be filed again but another can", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000902", status: "delivered", label: "Delivered", cancellable: false }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000902" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await page.getByLabel(/Amount you are claiming/).fill("10");
    await page.getByLabel("What happened?").fill("The box arrived crushed in transit.");
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);

    await page.goBack();
    await page.reload();
    await expect(page.getByLabel("Damaged goods")).toBeDisabled();
    await expect(page.getByLabel("Damaged goods")).toHaveAccessibleDescription(/already an open claim/);
    await expect(page.getByLabel("Something else")).toBeEnabled();
  });

  test("a shipment that isn't far enough along offers no claim, and the page explains why", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000903", status: "booking_confirmed", label: "Booking confirmed" }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000903" }).click();
    await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Make a claim" })).toHaveCount(0);

    const id = page.url().split("/").pop();
    await page.goto(`/shipments/${id}/claim`);
    await expect(page.getByText(/can't make a claim on this shipment right now/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit claim" })).toHaveCount(0);
    await expect(page.getByLabel("Something else")).toBeDisabled();
  });

  test("a guest can file and follow a claim in the tab they booked in, and nobody else can open it", async ({ page, browser, request }) => {
    const id = await bookAsGuest(page);
    await post(request, "/__shipment-status", { id, status: "delivered", label: "Delivered" });
    await page.reload();
    await page.getByRole("link", { name: "Make a claim" }).click();
    await page.getByLabel(/Amount you are claiming/).fill("15.00");
    await page.getByLabel("What happened?").fill("The parcel was damaged on arrival at the door.");
    await page.getByRole("button", { name: "Submit claim" }).click();

    await expect(page).toHaveURL(/\/claims\/C1$/);
    await expect(page.getByRole("heading", { name: "Damaged goods" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Damaged goods" })).toBeVisible();

    const stranger = await browser.newPage();
    await stranger.goto(page.url());
    await expect(stranger.locator("main").getByRole("alert")).toContainText("same browser tab");
    await stranger.close();
  });

  test("with no claims, the list says how to start one", async ({ page }) => {
    await signIn(page, "/account/claims");

    await expect(page.getByText("You haven't made any claims.")).toBeVisible();
    await expect(page.getByRole("link", { name: "your shipments" })).toHaveAttribute("href", "/account/shipments");
  });
});

test("signing out wipes this tab's support and claim tokens", async ({ page, request }) => {
  await page.goto("/support");
  await page.getByLabel("Subject").fill("Hello");
  await page.getByLabel("How can we help?").fill("A question.");
  await page.getByLabel("Your email").fill("guest@example.test");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/support\/tickets\//);
  await seed(request, [{ tracking: "LG000000001001" }]);

  await signIn(page, "/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /^(ticket-token|claim-shipment|guest-token):/.test(k)))).toEqual([]);
  void STUB_URL;
});

test("these pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
  await seed(request, [{ tracking: "LG000000001002", status: "delivered", label: "Delivered", cancellable: false }]);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await signIn(page, "/account/shipments");
  await page.getByRole("link", { name: "LG000000001002" }).click();
  await page.getByRole("link", { name: "Make a claim" }).click();
  await page.getByLabel(/Amount you are claiming/).fill("5");
  await page.getByLabel("What happened?").fill("Damaged on arrival at the door.");
  await page.getByRole("button", { name: "Submit claim" }).click();
  await expect(page).toHaveURL(/\/claims\/C1$/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/support");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) urls.push(new URL(key.url).pathname);

    return urls;
  });

  expect(overflow).toBeLessThanOrEqual(1);
  expect(cached.filter((path) => /^\/(support|claims|shipments|account)/.test(path))).toEqual([]);
  expect(violations).toEqual([]);
});
