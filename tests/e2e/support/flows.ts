import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { STUB_URL } from "../../../playwright.config";

export const PASSWORD = "Str0ng-Passphrase-1";

export const seed = (request: APIRequestContext, shipments: Record<string, unknown>[]) => request.post(`${STUB_URL}/__seed`, { data: { shipments } });
export const stubState = async (request: APIRequestContext) => (await request.get(`${STUB_URL}/__shop`)).json();
export const post = (request: APIRequestContext, path: string, data: Record<string, unknown>) => request.post(`${STUB_URL}${path}`, { data });

export async function signIn(page: Page, next: string, email = "ada@example.test") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?=&]/g, "\\$&") + "$"));
}

/** Books and pays as a guest, ending on the shipment page (the guest's token is in this tab's storage). Returns the shipment id. */
export async function bookAsGuest(page: Page): Promise<string> {
  await page.goto("/quote");
  const from = page.getByRole("group", { name: "Sending from" });
  const to = page.getByRole("group", { name: "Sending to" });
  await expect(to.getByRole("option", { name: "Germany" })).toBeAttached();
  await from.getByLabel("Country").selectOption("NG");
  await from.getByLabel("City").fill("Lagos");
  await to.getByLabel("Country").selectOption("DE");
  await to.getByLabel("City").fill("Berlin");
  await to.getByLabel(/Postal code/).fill("10115");
  await page.getByLabel(/Contents/).fill("Books");
  for (const [label, value] of [["Weight (kg)", "2"], ["Length (cm)", "30"], ["Width (cm)", "20"], ["Height (cm)", "10"]] as const) await page.getByLabel(label).fill(value);
  await page.getByLabel(/Declared value/).fill("100");
  await page.getByRole("button", { name: "Get prices" }).click();
  await page.getByRole("link", { name: "Book International Economy" }).click();
  await page.getByLabel("Your email").fill("guest@example.test");
  const sender = page.getByRole("group", { name: "Sender (collection address)" });
  const recipient = page.getByRole("group", { name: "Recipient (delivery address)" });
  await sender.getByLabel("Full name").fill("Ife Okoro");
  await sender.getByLabel("Phone").fill("+2348012345678");
  await sender.getByLabel("Address", { exact: true }).fill("1 Marina Road");
  await sender.getByLabel("State").fill("Lagos");
  await recipient.getByLabel("Full name").fill("Hans Becker");
  await recipient.getByLabel("Phone").fill("+4915112345678");
  await recipient.getByLabel("Address", { exact: true }).fill("2 Unter den Linden");
  await page.getByLabel(/I accept the terms/).check();
  await page.getByRole("button", { name: /Book and pay/ }).click();
  await page.getByRole("button", { name: "Pay (simulate success)" }).click();
  await expect(page).toHaveURL(/\/shipments\/\w+\?returned=1/);
  await expect(page.getByText("Payment received. Your shipment is confirmed.")).toBeVisible({ timeout: 15000 });

  return page.url().match(/shipments\/(\w+)/)![1];
}
