import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { completeTwoFactor, fetchCurrentUser, login, register } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { hasSignedInHint, safeNextPath, setSignedInHint } from "@/lib/auth/session";

const user = { id: "01A", name: "Ada", email: "ada@example.test", email_verified: true, roles: [], two_factor_enabled: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const withCsrf = (...responses: Response[]) => {
  document.cookie = "XSRF-TOKEN=t; path=/";
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);

  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("login", () => {
  it("returns the user when the password is enough", async () => {
    withCsrf(json({ data: user }));

    await expect(login("ada@example.test", "pw")).resolves.toEqual({ kind: "signed-in", user: { ...user, permissions: [] } });   // an API that predates permissions means none
  });

  it("reports the second step on a 202 without treating the body as a user", async () => {
    withCsrf(json({ data: { two_factor_required: true } }, 202));

    await expect(login("staff@example.test", "pw")).resolves.toEqual({ kind: "two-factor" });
  });

  it("refuses a response that is not a user", async () => {
    withCsrf(json({ data: { email: "x" } }));

    await expect(login("a@b.test", "pw")).rejects.toMatchObject({ code: "unexpected_response" });
  });
});

describe("other calls", () => {
  it("sends code or recovery code to the challenge endpoint", async () => {
    const mock = withCsrf(json({ data: user }), json({ data: user }));

    await completeTwoFactor({ recovery_code: "aaaaa-bbbbb" });

    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ recovery_code: "aaaaa-bbbbb" });
  });

  it("omits an empty phone number when registering", async () => {
    const mock = withCsrf(json({ data: user }, 201));

    await register({ name: "Ada", email: "ada@example.test", phone: "", password: "x", password_confirmation: "x" });

    expect(JSON.parse(mock.mock.calls[0][1].body)).not.toHaveProperty("phone");
  });

  it("reads 'nobody is signed in' as null, but still raises real failures", async () => {
    withCsrf(json({ error: { code: "unauthenticated", message: "no" } }, 401));
    await expect(fetchCurrentUser()).resolves.toBeNull();

    withCsrf(json({ error: { code: "server_error", message: "boom" } }, 500));
    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 500 });
  });
});

describe("safeNextPath", () => {
  it.each([["/account", "/account"], ["/track/LG1?x=1", "/track/LG1?x=1"], [null, "/account"], ["", "/account"]])("keeps %j as %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "account", "/ok\nSet-Cookie: x=1", "http://localhost:3000/account"])("refuses %j", (input) => {
    expect(safeNextPath(input)).toBe("/account");
  });

  it("uses the fallback it is given", () => {
    expect(safeNextPath("//x", "/")).toBe("/");
  });
});

describe("signed-in hint", () => {
  it("is a plain flag and survives blocked storage", () => {
    expect(hasSignedInHint()).toBe(false);
    setSignedInHint(true);
    expect(hasSignedInHint()).toBe(true);
    setSignedInHint(false);
    expect(hasSignedInHint()).toBe(false);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(hasSignedInHint()).toBe(false);
    expect(() => setSignedInHint(true)).not.toThrow();
  });
});

describe("describeError", () => {
  it("uses safe wording for rate limits and server faults, and the API's message otherwise", () => {
    expect(describeError(new ApiError(429, "too_many_requests", "x"))).toMatch(/Too many attempts/);
    expect(describeError(new ApiError(500, "server_error", "SQLSTATE[23505] secret detail"))).not.toContain("SQLSTATE");
    expect(describeError(new ApiError(0, "network", "We couldn't reach the server."))).toBe("We couldn't reach the server.");
    expect(describeError(new ApiError(403, "account_suspended", "This account has been suspended."))).toBe("This account has been suspended.");
    expect(describeError(new Error("weird"))).toBe("Something went wrong. Please try again.");
  });
});
