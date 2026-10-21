import { expect, test, type APIRequestContext } from "@playwright/test";
import { STUB_URL } from "../../playwright.config";
import { resetCms } from "./support/cms";
import { post, seed, signIn } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const adminState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__admin`)).json();
const shopState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__shop`)).json();
const BEA = "01HBEA" + "0".repeat(20);

const SHIPMENTS = [
  { tracking: "LG000000000801", status: "in_transit", label: "In transit", delayed: true },
  { tracking: "LG000000000802", status: "exception", label: "Exception" },
  { tracking: "LG000000000803", status: "delivered", label: "Delivered" },
];

test.describe("shipment list", () => {
  test("an operations manager sees what is late, narrows the list, and the filters live in the address", async ({ page, request }) => {
    await seed(request, SHIPMENTS);
    await signIn(page, "/admin", "ops@example.test");

    await expect(page.getByRole("link", { name: /Shipments running late/ })).toContainText("1");
    await expect(page.getByRole("link", { name: /Shipments with an exception/ })).toContainText("1");
    await page.getByRole("link", { name: /Shipments running late/ }).click();

    await expect(page).toHaveURL(/\/admin\/shipments\?stage=delayed$/);
    await expect(page.getByRole("link", { name: "LG000000000801" })).toBeVisible();
    await expect(page.getByRole("link", { name: "LG000000000802" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "LG000000000801" }).locator("xpath=ancestor::li")).toContainText("Running late");
    await expect(page.getByRole("link", { name: "LG000000000801" }).locator("xpath=ancestor::li")).toContainText("Ada Shipper");

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByText("3 shipments")).toBeVisible();
    await page.getByLabel("Search").fill("LG000000000803");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=LG000000000803$/);
    await expect(page.getByText("1 shipment", { exact: true })).toBeVisible();
    expect((await adminState(request)).shipmentQuery).toMatchObject({ q: "LG000000000803" });
    await page.reload();
    await expect(page.getByLabel("Search")).toHaveValue("LG000000000803");
  });

  test("a viewer without customer access sees no contact details and no editing tools", async ({ page, request }) => {
    await seed(request, SHIPMENTS);
    await signIn(page, "/admin/shipments", "viewer@example.test");

    await expect(page.getByRole("link", { name: "LG000000000801" }).locator("xpath=ancestor::li")).not.toContainText("ada@example.test");
    await page.getByRole("link", { name: "LG000000000801" }).click();
    await expect(page.getByText("Contact details are hidden for your role.").first()).toBeVisible();
    await expect(page.getByText("Marina Road")).toHaveCount(0);
    await expect(page.getByLabel("Move the shipment to")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Handling" }).getByLabel("Assigned to")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
    await expect(page.getByText("Nobody is handling this yet.")).toBeVisible();
  });
});

test.describe("shipment detail", () => {
  test("staff add a tracking update after confirming, and the customer then sees the new status", async ({ page, browser, request }) => {
    await seed(request, [{ tracking: "LG000000000811", status: "in_transit", label: "In transit", cancellable: false }]);
    const ops = await (await browser.newContext()).newPage();
    await signIn(ops, "/admin/shipments", "ops@example.test");
    await ops.getByRole("link", { name: "LG000000000811" }).click();

    await expect(ops.getByRole("heading", { name: "LG000000000811" })).toBeVisible();
    await expect(ops.getByText(/1 Marina Road/)).toBeVisible();
    const select = ops.getByLabel("Move the shipment to");
    await expect(select.getByRole("option")).toHaveText(["Choose a status…", "Arrived destination country", "Exception"]);

    await ops.getByRole("button", { name: "Review update" }).click();
    await expect(ops.getByText("Choose the status to move the shipment to.")).toBeVisible();
    await select.selectOption("exception");
    await ops.getByRole("button", { name: "Review update" }).click();
    await expect(ops.getByText("Say what went wrong.")).toBeVisible();
    await ops.getByLabel("What went wrong").selectOption("damaged");
    await ops.getByLabel("City").fill("Frankfurt");
    await ops.getByLabel("Country code").fill("de");
    await ops.getByLabel("Message for the customer").fill("The parcel was damaged at the hub; we are checking it.");
    await ops.getByRole("textbox", { name: "Internal note (staff only)" }).fill("Forklift incident.");
    await ops.getByRole("button", { name: "Review update" }).click();

    await expect(ops.getByRole("group", { name: "Confirm update" })).toContainText("The customer will see this");
    await ops.getByRole("button", { name: "Go back" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("track"))).toEqual([]);
    await ops.getByRole("button", { name: "Review update" }).click();
    await ops.getByRole("button", { name: "Yes, add the update" }).click();

    await expect(ops.getByText("Tracking updated.")).toBeVisible();
    const latest = ops.getByRole("list", { name: "Tracking events" }).getByRole("listitem").first();
    await expect(latest).toContainText("Exception");
    await expect(latest).toContainText("Internal: Forklift incident.");
    await expect(latest).toContainText("Frankfurt, DE");
    await expect(select.getByRole("option")).toHaveText(["Choose a status…", "In transit", "Out for delivery"]);
    expect((await shopState(request)).lastTrackingUpdate).toMatchObject({ status: "exception", exception_code: "damaged", location: { city: "Frankfurt", country: "DE" }, is_public: true });

    await signIn(page, "/account/shipments");
    await expect(page.getByRole("link", { name: "LG000000000811" }).locator("xpath=ancestor::li")).toContainText("Exception");
  });

  test("a private update is saved without telling the customer, and a stale form is refused with the reason", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000821", status: "in_transit", label: "In transit" }]);
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.getByRole("link", { name: "LG000000000821" }).click();

    await page.getByLabel("Move the shipment to").selectOption("arrived_destination_country");
    await page.getByLabel("Show this update to the customer").uncheck();
    await page.getByRole("button", { name: "Review update" }).click();
    await expect(page.getByRole("group", { name: "Confirm update" })).toContainText("Only staff will see this.");
    await page.getByRole("button", { name: "Go back" }).click();
    await page.getByLabel("Show this update to the customer").check();

    await post(request, "/__shipment-status", { tracking: "LG000000000821", status: "delivered", label: "Delivered" });   // someone else moved it first
    await page.getByRole("button", { name: "Review update" }).click();
    await page.getByRole("button", { name: "Yes, add the update" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText("cannot be moved to “Arrived destination country” by hand");
    await expect(page.getByLabel("Move the shipment to")).toHaveValue("arrived_destination_country");
  });

  test("staff hand a shipment to a colleague and leave an internal note", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000831", status: "in_transit", label: "In transit" }]);
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.getByRole("link", { name: "LG000000000831" }).click();

    const select = page.getByRole("region", { name: "Handling" }).getByLabel("Assigned to");
    await expect(select.getByRole("option")).toHaveText(["Nobody", "Olu Ops (you)", "Bea Booker", "Cal Carter"]);
    await select.selectOption({ label: "Bea Booker" });
    await expect(page.getByText("Assigned to Bea Booker.")).toBeVisible();
    expect((await adminState(request)).log).toContain(`ship-assign:LG000000000831:${BEA}`);

    await page.getByRole("textbox", { name: /^Add a note/ }).fill("Customer asked for a call before delivery.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Note added.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Notes" })).toContainText("Customer asked for a call before delivery.");

    await page.goto("/admin/shipments");
    await expect(page.getByRole("link", { name: "LG000000000831" }).locator("xpath=ancestor::li")).toContainText("handled by Bea Booker");
    await page.getByLabel("Assigned to").selectOption({ label: "Bea Booker" });
    await expect(page).toHaveURL(new RegExp(`assigned_to=${BEA}$`));
    await expect(page.getByRole("link", { name: "LG000000000831" })).toBeVisible();
  });
});

test.describe("access", () => {
  test("a ticket agent has no shipments section", async ({ page }) => {
    await signIn(page, "/admin/shipments", "agent@example.test");

    await expect(page.locator("main").getByRole("alert")).toContainText("doesn't have access");
    await expect(page.getByRole("navigation", { name: "Back office" }).getByRole("link", { name: "Shipments" })).toHaveCount(0);
  });

  test("shipment pages work under the security policy, are never saved offline, and fit a phone", async ({ page, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160)); });
    await seed(request, SHIPMENTS);
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("link", { name: "LG000000000801" })).toBeVisible();
    const overflowList = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("link", { name: "LG000000000801" }).click();
    await expect(page.getByRole("button", { name: "Review update" })).toBeVisible();
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

test.describe("cancelling, refunding and proof of delivery", () => {
  const jpeg = (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)]) });

  test("staff cancel a paid shipment before collection, the customer is refunded, and the reason shows", async ({ page, browser, request }) => {
    await seed(request, [{ tracking: "LG000000000851", status: "booking_confirmed", label: "Booking confirmed", total: 7041 }, { tracking: "LG000000000852", status: "in_transit", label: "In transit" }]);
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.getByRole("link", { name: "LG000000000852" }).click();
    await expect(page.getByRole("heading", { name: "LG000000000852" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cancel this shipment" })).toHaveCount(0);   // collected: too late

    await page.goto("/admin/shipments");
    await page.getByRole("link", { name: "LG000000000851" }).click();
    const panel = page.getByRole("region", { name: "Cancel this shipment" });
    await expect(panel).toContainText("refunded $70.41 to their original payment method");
    await expect(page.getByRole("region", { name: "Refund" })).toHaveCount(0);   // this role cannot approve refunds on their own

    await panel.getByLabel(/Reason/).fill("Customer phoned to cancel");
    await panel.getByRole("button", { name: "Review cancellation" }).click();
    await expect(page.getByRole("group", { name: "Confirm cancellation" })).toContainText("refund $70.41");
    await page.getByRole("button", { name: "Keep it" }).click();
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("ship-cancel"))).toEqual([]);
    await panel.getByRole("button", { name: "Review cancellation" }).click();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();

    await expect(page.getByText("This shipment was cancelled: Customer phoned to cancel.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Cancel this shipment" })).toHaveCount(0);
    expect((await adminState(request)).log).toContain("ship-cancel:LG000000000851:Customer phoned to cancel");
    await expect(page.getByRole("list", { name: "Tracking events" }).getByRole("listitem").first()).toContainText("Cancelled");

    const customer = await (await browser.newContext()).newPage();
    await signIn(customer, "/account/shipments");
    await expect(customer.getByRole("link", { name: "LG000000000851" }).locator("xpath=ancestor::li")).toContainText("Cancelled");
  });

  test("an approver refunds part of a payment, then the rest, and is stopped from refunding more than is left", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000861", status: "in_transit", label: "In transit", total: 7041 }]);
    await signIn(page, "/admin/shipments", "admin@example.test");
    await page.getByRole("link", { name: "LG000000000861" }).click();

    const panel = page.getByRole("region", { name: "Refund" });
    await expect(panel).toContainText("Paid $70.41; already refunded $0.00; still refundable $70.41.");
    await panel.getByLabel("Amount (USD)").fill("80.00");
    await expect(panel.getByText("At most $70.41 can still be refunded.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Review refund" })).toBeDisabled();
    await panel.getByLabel("Amount (USD)").fill("10.00");
    await panel.getByLabel("Reason").fill("Goodwill for the delay");
    await panel.getByRole("button", { name: "Review refund" }).click();
    await expect(page.getByRole("group", { name: "Confirm refund" })).toContainText("Refund $10.00");
    await page.getByRole("button", { name: "Yes, refund" }).click();

    await expect(page.getByText("Refunded $10.00.")).toBeVisible();
    await expect(panel).toContainText("already refunded $10.00; still refundable $60.41");
    expect((await adminState(request)).log).toContain("ship-refund:LG000000000861:10.00:Goodwill for the delay");

    await panel.getByLabel("Reason").fill("Remainder, service failure");
    await panel.getByRole("button", { name: "Review refund" }).click();
    await expect(page.getByRole("group", { name: "Confirm refund" })).toContainText("Refund $60.41");
    await page.getByRole("button", { name: "Yes, refund" }).click();

    await expect(page.getByRole("region", { name: "Refund" })).toHaveCount(0);
    expect((await adminState(request)).log).toContain("ship-refund:LG000000000861:60.41:Remainder, service failure");
  });

  test("staff attach proof of delivery, it is listed with the delivery and can be downloaded, and bad files are refused", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000871", status: "delivered", label: "Delivered" }]);
    await signIn(page, "/admin/shipments", "ops@example.test");
    await page.getByRole("link", { name: "LG000000000871" }).click();

    await expect(page.getByText("Nothing attached yet.")).toBeVisible();
    await page.getByTestId("proof-input").setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(page.locator("main").getByRole("alert")).toContainText("“setup.exe”: Only PDF, JPEG and PNG files are accepted.");
    await page.getByTestId("proof-input").setInputFiles({ name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("MZ this is a program") });
    await expect(page.locator("main").getByRole("alert")).toContainText("Only PDF, JPEG and PNG documents are accepted.");
    expect((await adminState(request)).log.filter((l: string) => l.startsWith("proof"))).toEqual([]);

    await page.getByTestId("proof-input").setInputFiles(jpeg("doorstep.jpg"));
    await expect(page.getByText("doorstep.jpg was attached.")).toBeVisible();
    const files = page.getByRole("list", { name: "Proof of delivery files" });
    await expect(files).toContainText("doorstep.jpg");
    expect((await adminState(request)).log).toContain("proof:LG000000000871:doorstep.jpg");

    const [download] = await Promise.all([page.waitForEvent("download"), files.getByRole("button", { name: /Download doorstep\.jpg/ }).click()]);
    expect(download.suggestedFilename()).toBe("invoice.pdf");   // the stub serves one file for every document link
  });

  test("a viewer sees the proof but cannot add any", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000881", status: "delivered", label: "Delivered" }]);
    await signIn(page, "/admin/shipments", "viewer@example.test");
    await page.getByRole("link", { name: "LG000000000881" }).click();

    await expect(page.getByText("Nothing attached yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach proof of delivery" })).toHaveCount(0);
  });
});
