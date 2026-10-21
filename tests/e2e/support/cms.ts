import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { REVALIDATE_SECRET, STUB_URL } from "../../../playwright.config";

/** Change what the stub CMS serves. Takes effect on the site only after revalidation. */
export async function setCmsState(request: APIRequestContext, state: Record<string, unknown>) {
  const response = await request.post(`${STUB_URL}/__state`, { data: state });
  expect(response.ok()).toBe(true);
}

/**
 * Back to the default CMS state, and wait until the site actually serves it. Revalidation is
 * stale-while-revalidate, so without waiting the next test could still see the previous state.
 */
export async function resetCms(request: APIRequestContext) {
  await request.post(`${STUB_URL}/__reset`);
  await revalidateAll(request);

  await expect(async () => {
    const response = await request.get("/");
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain("Ship anywhere. Track everything.");
    expect(html).not.toContain("scheduled maintenance");
    expect(html).not.toContain("Holiday delays expected");
  }).toPass({ timeout: 20_000, intervals: [300, 500, 1000] });
}

/** What Laravel's RevalidateFrontend job does after a publish. */
export async function revalidateAll(request: APIRequestContext, paths: string[] = []) {
  const response = await request.post("/api/revalidate", {
    headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
    data: { paths },
  });
  expect(response.status()).toBe(200);
}

/**
 * Revalidation is stale-while-revalidate: the first request after a change may still
 * see the old page, so reload until the new content shows.
 */
export async function expectEventually(page: Page, assertion: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await assertion();
  }).toPass({ timeout: 15_000, intervals: [500, 1000] });
}
