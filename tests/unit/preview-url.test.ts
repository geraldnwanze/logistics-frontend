import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { getPreviewPage } from "@/lib/cms/api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("getPreviewPage", () => {
  it.each([
    "https://evil.test/api/v1/public/preview/01ABC?signature=x",
    "http://localhost:8000.evil.test/api/v1/public/preview/01ABC",
    "not a url",
    "http://localhost:8000/api/v1/admin/cms/pages",
    "http://localhost:8000/api/v1/public/pages/home",
  ])("never fetches %s", async (url) => {
    expect(await getPreviewPage(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a signed preview on our API uncached and returns the draft", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { id: "01", slug: "x", title: "Draft", blocks: [], meta: {}, published_at: null },
    })));

    const page = await getPreviewPage("http://localhost:8000/api/v1/public/preview/01ABC?expires=1&signature=abc");

    expect(page?.title).toBe("Draft");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("returns null when the link has expired", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));

    expect(await getPreviewPage("http://localhost:8000/api/v1/public/preview/01ABC?signature=old")).toBeNull();
  });
});
