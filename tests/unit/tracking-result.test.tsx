import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingResult } from "@/components/tracking/tracking-result";
import { readSaved, saveTracking } from "@/lib/tracking/saved";
import { trackingFixture } from "./tracking-data";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function renderResult(number: string) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });

  return render(<QueryClientProvider client={client}><TrackingResult number={number} /></QueryClientProvider>);
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("TrackingResult", () => {
  it("shows status, route, estimate and the history newest first, and saves a copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: trackingFixture() })));
    renderResult("lg-000000000001");

    expect(await screen.findByRole("heading", { name: "In transit", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("From").nextElementSibling).toHaveTextContent("Lagos, NG");
    expect(screen.getByText("To").nextElementSibling).toHaveTextContent("Berlin, DE");
    expect(screen.getByText(/2026-10-20 to 2026-10-24/)).toBeInTheDocument();
    expect(screen.getByText(/\(estimate\)/)).toBeInTheDocument();

    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("In transit");
    expect(entries[0]).toHaveTextContent("FRA hub, Frankfurt, DE");
    expect(entries[1]).toHaveTextContent("Booking confirmed");

    await waitFor(() => expect(readSaved()[0]?.number).toBe("LG000000000001"));
  });

  it("labels demonstration shipments and passes on the API's notice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: trackingFixture() })));
    renderResult("LG000000000001");

    expect(await screen.findByText(/Demonstration shipment/)).toBeInTheDocument();
    expect(screen.getByText(/simulated demonstration data/)).toBeInTheDocument();
  });

  it("shows delivery without an estimate, and only the masked receiver name", async () => {
    const delivered = trackingFixture({ is_demo: false, notice: null, estimated_delivery: null, delivered_at: "2026-10-18T12:00:00+00:00", status: { code: "delivered", label: "Delivered" } });
    delivered.timeline[1].delivered_to = "H. B.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: delivered })));
    renderResult("LG000000000001");

    expect(await screen.findByRole("heading", { name: "Delivered", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/Demonstration shipment/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(estimate\)/)).not.toBeInTheDocument();
    expect(screen.getByText("Received by H. B.")).toBeInTheDocument();
  });

  it("renders hostile text from the API as text", async () => {
    const hostile = trackingFixture({ service: "<img src=x onerror=alert(1)>" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: hostile })));
    const { container } = renderResult("LG000000000001");

    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("says plainly when a number is unknown and never falls back to a saved copy for it", async () => {
    saveTracking("LG000000000404", trackingFixture());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code: "not_found" } }, 404)));
    renderResult("LG000000000404");

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find a shipment/);
    expect(screen.queryByRole("heading", { name: "In transit" })).not.toBeInTheDocument();
  });

  it("explains rate limiting with the wait time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 429, { "Retry-After": "45" })));
    renderResult("LG000000000429");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many lookups/);
    expect(screen.getByText(/about 45 seconds/)).toBeInTheDocument();
  });

  it("falls back to the saved copy, marked with when it was saved, when the network fails", async () => {
    saveTracking("LG000000000001", trackingFixture({ status: { code: "picked_up", label: "Picked up" } }), new Date("2026-10-14T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderResult("LG000000000001");

    expect(await screen.findByRole("heading", { name: "Picked up", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/saved on this device on .*2026/);
    expect(screen.getByRole("status")).toHaveTextContent(/newer updates may be missing/);
  });

  it("also uses the saved copy when the service is down, but not for other numbers", async () => {
    saveTracking("LG000000000001", trackingFixture());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 503)));
    renderResult("LG000000000009");

    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
  });

  it("shows an offline error when there is nothing saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderResult("LG000000000001");

    expect(await screen.findByRole("alert")).toHaveTextContent(/appear to be offline/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("recovers when the visitor retries and the connection is back", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(json({ data: trackingFixture() }));
    vi.stubGlobal("fetch", fetchMock);
    renderResult("LG000000000001");

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "In transit", level: 2 })).toBeInTheDocument();
  });

  it("removes the saved copy on request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: trackingFixture() })));
    renderResult("LG000000000001");
    await screen.findByRole("heading", { name: "In transit", level: 2 });
    await waitFor(() => expect(readSaved()).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "Remove saved tracking" }));

    expect(readSaved()).toEqual([]);
  });
});
