import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { API_URL } from "@/lib/env";
import {
  menuResponseSchema, pageResponseSchema, pageSchema, settingsSchema,
  type CmsPage, type Menu, type SiteSettings,
} from "./schemas";

export type PageResult =
  | { kind: "page"; page: CmsPage }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "not-found" };

/**
 * GET against the Laravel public API. 404 resolves to null; any other failure throws so
 * a transient API error is never cached as "page not found".
 */
async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
  const response = await fetch(`${API_URL}/api/v1${path}`, { headers: { Accept: "application/json" } });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`CMS API ${path} responded ${response.status}`);
  }

  return schema.parse(await response.json());
}

/**
 * Cached per slug until the Laravel API calls /api/revalidate (tags `cms` and `page:<slug>`).
 */
export async function getPage(slug: string): Promise<PageResult> {
  "use cache";
  cacheTag("cms", `page:${slug}`);
  cacheLife("days");

  const body = await apiGet(`/public/pages/${slug.split("/").map(encodeURIComponent).join("/")}`, pageResponseSchema);

  if (body?.redirect) {
    return { kind: "redirect", to: body.redirect.to, status: body.redirect.status };
  }

  return body?.data ? { kind: "page", page: body.data } : { kind: "not-found" };
}

export async function getSettings(): Promise<SiteSettings | null> {
  "use cache";
  cacheTag("cms", "cms-shared");
  cacheLife("days");

  const body = await apiGet("/public/settings", z.object({ data: settingsSchema }));

  return body?.data ?? null;
}

export async function getMenu(key: string): Promise<Menu | null> {
  "use cache";
  cacheTag("cms", "cms-shared");
  cacheLife("days");

  const body = await apiGet(`/public/menus/${encodeURIComponent(key)}`, menuResponseSchema);

  return body?.data ?? null;
}

/**
 * Draft preview. Deliberately uncached; only accepts a signed URL on our own API.
 */
export async function getPreviewPage(signedUrl: string): Promise<CmsPage | null> {
  const url = URL.parse(signedUrl);
  const allowed = new URL(API_URL);

  if (url === null || url.origin !== allowed.origin || !url.pathname.startsWith("/api/v1/public/preview/")) {
    return null;
  }

  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });

  if (!response.ok) {
    return null;
  }

  return z.object({ data: pageSchema }).parse(await response.json()).data;
}
