import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

import { POST } from "@/app/api/revalidate/route";

const SECRET = "test-secret-value";

function call(body: unknown, token: string | null = SECRET) {
  return POST(new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  revalidateTag.mockClear();
  vi.stubEnv("REVALIDATE_SECRET", SECRET);
});

describe("POST /api/revalidate", () => {
  it.each([[null], ["wrong-secret-val!"], ["short"], [""]])("rejects token %j", async (token) => {
    const response = await call({ paths: [] }, token);

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects every request when no secret is configured", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");

    expect((await call({ paths: [] }, "")).status).toBe(401);
  });

  it("revalidates everything for an empty path list", async () => {
    const response = await call({ paths: [] });

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("cms", "max");
  });

  it("revalidates shared data plus each page tag, mapping / to home", async () => {
    await call({ paths: ["/about-us", "/", "/services/air-freight/"] });

    const tags = revalidateTag.mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(["cms-shared", "page:about-us", "page:home", "page:services/air-freight"]);
    expect(revalidateTag.mock.calls.every(([, profile]) => profile === "max")).toBe(true);
  });

  it("rejects malformed bodies", async () => {
    expect((await call({ paths: "nope" })).status).toBe(422);
    expect((await call({ paths: [123] })).status).toBe(422);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("treats an empty body as revalidate-all", async () => {
    expect((await call("")).status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("cms", "max");
  });
});
