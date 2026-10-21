import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api/client";

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const csrf = () => new Response(null, { status: 204 });

function setXsrfCookie(value: string | null) {
  document.cookie = `XSRF-TOKEN=${value ?? ""}; path=/${value === null ? "; max-age=0" : ""}`;
}

beforeEach(() => setXsrfCookie("token%2Fvalue"));
afterEach(() => {
  vi.unstubAllGlobals();
  setXsrfCookie(null);
});

describe("apiRequest", () => {
  it("does not fetch a new CSRF cookie when it already has one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/auth/logout", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends reads with the session cookie and no CSRF round trip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/me")).resolves.toEqual({ status: 200, body: { data: 1 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/me$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", method: "GET" });
  });

  it("fetches the CSRF cookie when it is missing and echoes it, decoded, in the header", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => {
      document.cookie = "XSRF-TOKEN=abc%2Fdef; path=/";

      return csrf();
    }).mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setXsrfCookie(null);

    await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.test" } });

    const [csrfUrl, csrfInit] = fetchMock.mock.calls[0];
    const [, init] = fetchMock.mock.calls[1];
    expect(csrfUrl).toMatch(/\/sanctum\/csrf-cookie$/);
    expect(csrfInit).toMatchObject({ credentials: "include" });
    expect(init.headers["X-XSRF-TOKEN"]).toBe("abc/def");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"email":"a@b.test"}');
  });

  it("retries once with a fresh token when the server says the CSRF token expired", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: "csrf_token_mismatch", message: "CSRF token mismatch." } }, 419))
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(json({ data: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toMatch(/csrf-cookie$/);
  });

  it("does not retry a second 419", async () => {
    const mismatch = () => json({ error: { code: "csrf_token_mismatch", message: "nope" } }, 419);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => (url.includes("csrf-cookie") ? csrf() : mismatch()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/auth/logout", { method: "POST" })).rejects.toMatchObject({ status: 419, code: "csrf_token_mismatch" });
  });

  it("turns the API's error envelope into an ApiError with field messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code: "validation_failed", message: "The given data was invalid.", request_id: "req_1", errors: { email: ["Taken."], password: ["Too short.", "Weak."] } } }, 422)));

    const error = await apiRequest("/me").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "validation_failed", requestId: "req_1" });
    expect(error.field("email")).toBe("Taken.");
    expect(error.field("password")).toBe("Too short.");
    expect(error.field("name")).toBeUndefined();
  });

  it("copes with error responses that are not the envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })));

    await expect(apiRequest("/me")).rejects.toMatchObject({ status: 502, code: "unexpected_response" });
  });

  it("reports an unreachable server as a network error, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiRequest("/me")).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("lets aborts through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));

    await expect(apiRequest("/me")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("accepts empty 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(null, 204)));

    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toEqual({ status: 204, body: null });
  });
});

describe("file uploads", () => {
  it("sends a FormData body untouched, so the browser sets the multipart boundary itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("type", "other");

    await apiRequest("/shipments/S1/documents", { method: "POST", body: form, headers: { "X-Guest-Token": "t" } });

    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.headers["X-XSRF-TOKEN"]).toBe("token/value");
    expect(init.headers["X-Guest-Token"]).toBe("t");
  });
});
