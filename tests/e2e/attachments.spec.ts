import { expect, test, type Page } from "@playwright/test";
import { resetCms } from "./support/cms";
import { post, seed, signIn, stubState } from "./support/flows";

test.beforeEach(async ({ request }) => resetCms(request));

const pdf = (name = "receipt.pdf", size = 2048) => ({ name, mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(size)]) });
const jpeg = (name = "damage.jpg", size = 4096) => ({ name, mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size)]) });
const disguised = (name = "evidence.pdf") => ({ name, mimeType: "application/pdf", buffer: Buffer.from("MZ this is really a program") });

const attach = (page: Page, files: ReturnType<typeof pdf>[]) => page.getByTestId("attachment-input").setInputFiles(files);

async function openGuestTicket(page: Page, files: ReturnType<typeof pdf>[] = []) {
  await page.goto("/support");
  await page.getByLabel("Subject").fill("Damaged parcel");
  await page.getByLabel("How can we help?").fill("Photos of the damage are attached.");
  await page.getByLabel("Your email").fill("guest@example.test");
  if (files.length) await attach(page, files);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.describe("support ticket attachments", () => {
  test("a guest sends photos with a ticket, sees them on the message, and can download one", async ({ page, request }) => {
    await openGuestTicket(page, [jpeg(), pdf()]);

    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);
    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages.getByRole("button", { name: "Download damage.jpg" })).toBeVisible();
    await expect(messages.getByRole("button", { name: "Download receipt.pdf" })).toBeVisible();
    expect((await stubState(request)).attachments.map((a: { name: string }) => a.name)).toEqual(["damage.jpg", "receipt.pdf"]);

    const linkRequest = page.waitForRequest((r) => /support\/tickets\/T1\/attachments\/ATT1$/.test(r.url()));
    await messages.getByRole("button", { name: "Download damage.jpg" }).click();
    expect((await linkRequest).headers()["x-ticket-token"]).toBe("ticket-token-T1");
  });

  test("the chosen files are listed before sending, can be removed, and refused types are explained", async ({ page }) => {
    await page.goto("/support");
    await attach(page, [jpeg(), { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);

    const list = page.getByRole("list", { name: "Files to send" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(page.locator("main").getByRole("alert").filter({ hasText: "setup.exe" })).toContainText("Only PDF, JPEG and PNG files are accepted.");
    await expect(list.locator("img")).toHaveAttribute("src", /^blob:/);

    await page.getByRole("button", { name: "Remove damage.jpg" }).click();
    await expect(list).toHaveCount(0);
  });

  test("a file that only pretends to be a PDF is refused by the server and the message isn't lost", async ({ page }) => {
    await openGuestTicket(page, [disguised()]);

    await expect(page.locator("main").getByRole("alert")).toContainText("“evidence.pdf” isn't a PDF, JPEG or PNG file.");
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByLabel("How can we help?")).toHaveValue("Photos of the damage are attached.");
    await page.getByRole("button", { name: "Remove evidence.pdf" }).click();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);
  });

  test("a reply can carry a file, and staff files show up for the customer", async ({ page, request }) => {
    await openGuestTicket(page);
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);

    await post(request, "/__ticket", { id: "T1", staffReply: "Please send the label.", files: ["next-steps.pdf"], status: "pending_customer" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Download next-steps.pdf" })).toBeVisible();

    await page.getByLabel("Your reply").fill("Label attached.");
    await attach(page, [jpeg("label.jpg")]);
    await page.getByRole("button", { name: "Send reply" }).click();

    const mine = page.getByText("Label attached.").locator("xpath=ancestor::li");
    await expect(mine.getByRole("button", { name: "Download label.jpg" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Files to send" })).toHaveCount(0);
  });

  test("files on staff-only notes never reach the customer", async ({ page, request }) => {
    await openGuestTicket(page);
    await expect(page).toHaveURL(/\/support\/tickets\/T1$/);
    await post(request, "/__ticket", { id: "T1", internalNote: "Customer is a repeat claimant", staffReply: "We're looking into it." });
    await page.reload();

    await expect(page.getByText("We're looking into it.")).toBeVisible();
    await expect(page.getByText("repeat claimant")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download internal-only.pdf" })).toHaveCount(0);
    expect(await page.content()).not.toContain("internal-only.pdf");
  });

  test("file names are shown as text, never as markup", async ({ page }) => {
    await openGuestTicket(page, [pdf("<img src=x onerror=alert(1)>.pdf")]);

    await expect(page.getByRole("button", { name: "Download <img src=x onerror=alert(1)>.pdf" })).toBeVisible();
    await expect(page.locator("main img[src='x']")).toHaveCount(0);
  });

  test("at most five files go with one message", async ({ page }) => {
    await page.goto("/support");
    await attach(page, Array.from({ length: 7 }, (_, i) => pdf(`doc-${i}.pdf`)));

    await expect(page.getByRole("list", { name: "Files to send" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.locator("main").getByRole("alert")).toContainText("“doc-5.pdf” wasn't added");
    await expect(page.getByRole("button", { name: "Add photos or documents" })).toBeDisabled();
  });
});

test.describe("claim evidence", () => {
  test("a customer files a claim with photos, adds more when asked, and downloads their evidence", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000911", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000911" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();

    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await expect(page.getByText(/Photos of the damage/)).toBeVisible();
    await attach(page, [jpeg("crushed-box.jpg"), pdf("invoice.pdf")]);
    await page.getByRole("button", { name: "Submit claim" }).click();

    await expect(page).toHaveURL(/\/claims\/C1$/);
    await expect(page.getByRole("button", { name: "Download crushed-box.jpg" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download invoice.pdf" })).toBeVisible();

    await post(request, "/__claim", { id: "C1", status: "info_requested", staffNote: "Please send a photo of the label.", files: ["claim-form.pdf"] });
    await page.reload();
    await expect(page.getByRole("button", { name: "Download claim-form.pdf" })).toBeVisible();

    await page.getByLabel(/Add a message|Your reply/).fill("Here is the label.");
    await attach(page, [jpeg("label.jpg")]);
    await page.getByRole("button", { name: "Send" }).click();
    const mine = page.getByText("Here is the label.").locator("xpath=ancestor::li");
    await expect(mine.getByRole("button", { name: "Download label.jpg" })).toBeVisible();

    const linkRequest = page.waitForRequest((r) => /claims\/C1\/attachments\/ATT1$/.test(r.url()));
    await page.getByRole("button", { name: "Download crushed-box.jpg" }).click();
    await linkRequest;
  });

  test("a claim with a refused file stays open for correction", async ({ page, request }) => {
    await seed(request, [{ tracking: "LG000000000912", status: "delivered", label: "Delivered", cancellable: false, total: 7041 }]);
    await signIn(page, "/account/shipments");
    await page.getByRole("link", { name: "LG000000000912" }).click();
    await page.getByRole("link", { name: "Make a claim" }).click();

    await page.getByLabel(/Amount you are claiming/).fill("20.00");
    await page.getByLabel("What happened?").fill("The box arrived crushed and the books inside were ruined.");
    await attach(page, [disguised("proof.pdf")]);
    await page.getByRole("button", { name: "Submit claim" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText("“proof.pdf” isn't a PDF, JPEG or PNG file.");
    await expect(page.getByLabel("What happened?")).toHaveValue(/crushed/);
    await page.getByRole("button", { name: "Remove proof.pdf" }).click();
    await page.getByRole("button", { name: "Submit claim" }).click();
    await expect(page).toHaveURL(/\/claims\/C1$/);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the attachment controls fit the screen and stay reachable", async ({ page }) => {
    await page.goto("/support");
    await attach(page, [jpeg("a-very-long-photo-file-name-from-my-phone-camera-roll-0001.jpg"), pdf()]);

    const button = page.getByRole("button", { name: "Add photos or documents" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const remove = page.getByRole("button", { name: /Remove a-very-long/ });
    await remove.scrollIntoViewIfNeeded();
    const box = (await remove.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.height).toBeGreaterThanOrEqual(40);
  });
});
