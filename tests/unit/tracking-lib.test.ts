import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTracking, normaliseTrackingNumber, TrackingLookupError } from "@/lib/tracking/api";
import { clearSaved, readSaved, readSavedFor, saveTracking } from "@/lib/tracking/saved";
import { trackingSchema } from "@/lib/tracking/schemas";
import { trackingFixture } from "./tracking-data";

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("normaliseTrackingNumber", () => {
  it.each([["lg-1234 abcd", "LG1234ABCD"], ["  LG000000000001 ", "LG000000000001"], ["lg000000000001", "LG000000000001"]])("%j becomes %j", (input, expected) => {
    expect(normaliseTrackingNumber(input)).toBe(expected);
  });
});

describe("fetchTracking", () => {
  it("requests the normalised, encoded number and returns validated data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: trackingFixture() }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTracking("lg-000000000001")).resolves.toMatchObject({ tracking_number: "LG000000000001" });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/public\/tracking\/LG000000000001$/);
  });

  it("never puts hostile input into the URL path unencoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTracking("../../admin?x=<a>")).rejects.toMatchObject({ reason: "not-found" });
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/\.\.\/|<|\?x=/);
  });

  it.each([
    [404, "not-found"], [429, "rate-limited"], [500, "unavailable"], [503, "unavailable"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status, headers: { "Retry-After": "30" } })));

    const error = await fetchTracking("LG000000000001").catch((e) => e);

    expect(error).toBeInstanceOf(TrackingLookupError);
    expect(error.reason).toBe(reason);
    if (status === 429) expect(error.retryAfterSeconds).toBe(30);
  });

  it("reports a network failure as offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchTracking("LG000000000001")).rejects.toMatchObject({ reason: "offline" });
  });

  it("treats an unexpected response shape as unavailable instead of rendering it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { tracking_number: "LG000000000001" } })));

    await expect(fetchTracking("LG000000000001")).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("saved tracking", () => {
  it("keeps the latest result per number, newest first, at most five", () => {
    for (let i = 1; i <= 7; i++) saveTracking(`LG00000000000${i}`, trackingFixture({ tracking_number: `LG00000000000${i}` }));
    saveTracking("LG000000000004", trackingFixture({ status: { code: "delivered", label: "Delivered" } }));

    const saved = readSaved();

    expect(saved).toHaveLength(5);
    expect(saved[0].number).toBe("LG000000000004");
    expect(saved[0].tracking.status.label).toBe("Delivered");
    expect(saved.map((s) => s.number)).not.toContain("LG000000000001");
  });

  it("round-trips a result with the time it was saved", () => {
    saveTracking("LG000000000001", trackingFixture(), new Date("2026-10-15T10:00:00Z"));

    expect(readSavedFor("LG000000000001")).toMatchObject({ savedAt: "2026-10-15T10:00:00.000Z" });
    expect(readSavedFor("LG999999999999")).toBeNull();
  });

  it("ignores corrupt, tampered or wrongly shaped storage", () => {
    localStorage.setItem("tracking:saved:v1", "{not json");
    expect(readSaved()).toEqual([]);

    localStorage.setItem("tracking:saved:v1", JSON.stringify([{ number: "X", savedAt: "now", tracking: { status: "<script>" } }, "junk", null]));
    expect(readSaved()).toEqual([]);

    localStorage.setItem("tracking:saved:v1", JSON.stringify({ not: "an array" }));
    expect(readSaved()).toEqual([]);
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });

    expect(() => saveTracking("LG000000000001", trackingFixture())).not.toThrow();
    expect(readSaved()).toEqual([]);
    expect(() => clearSaved()).not.toThrow();
  });

  it("clears everything", () => {
    saveTracking("LG000000000001", trackingFixture());
    clearSaved();

    expect(readSaved()).toEqual([]);
  });
});

describe("schema", () => {
  it("accepts the shape the API documents", () => {
    expect(trackingSchema.safeParse(trackingFixture()).success).toBe(true);
  });
});
