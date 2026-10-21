import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listHref, parseFilter, parsePage, ShipmentsList } from "@/components/account/shipments-list";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { money, paged, shipment } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/shipping/api");

const api = vi.mocked(shippingApi);

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("list address helpers", () => {
  it("only accepts known filters and sensible page numbers", () => {
    expect(parseFilter("active")).toBe("active");
    expect(parseFilter("bogus")).toBe("all");
    expect(parseFilter(null)).toBe("all");
    expect([parsePage("3"), parsePage("0"), parsePage("-2"), parsePage("1.5"), parsePage("abc"), parsePage(null), parsePage("999999")]).toEqual([3, 1, 1, 1, 1, 1, 1]);
  });

  it("builds addresses that keep the filter and search, leaving out the defaults", () => {
    expect(listHref("all", "", 1)).toBe("/account/shipments");
    expect(listHref("active", "", 1)).toBe("/account/shipments?status=active");
    expect(listHref("delivered", " LG12 ", 3)).toBe("/account/shipments?status=delivered&q=LG12&page=3");
  });
});

describe("ShipmentsList", () => {
  it("shows each shipment with its route, status, price and a link to it", async () => {
    api.fetchShipments.mockResolvedValue(paged([shipment(), shipment({ id: "S2", tracking_number: "LG000000000002", status: "delivered", status_label: "Delivered", payment: { ...shipment().payment, requires_payment: false, status: "paid" } })], { total: 2 }));
    renderWithClient(<ShipmentsList />);

    const first = (await screen.findByRole("link", { name: "LG000000000001" })).closest("li")!;
    expect(first).toHaveTextContent("Lagos, NG → Berlin, DE");
    expect(first).toHaveTextContent("Booking pending");
    expect(first).toHaveTextContent("Payment needed");
    expect(first).toHaveTextContent("70.41");
    expect(screen.getByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/shipments/01SHIP000001AAAAAA");
    expect(screen.getByRole("link", { name: "LG000000000002" }).closest("li")).not.toHaveTextContent("Payment needed");
    expect(screen.getByText("2 shipments")).toBeInTheDocument();
  });

  it("asks the API for the page, filter and search in the address", async () => {
    searchParams.set("status", "active");
    searchParams.set("q", "LG00");
    searchParams.set("page", "2");
    api.fetchShipments.mockResolvedValue(paged([shipment()], { page: 2, lastPage: 3, total: 41 }));
    renderWithClient(<ShipmentsList />);

    await screen.findByRole("link", { name: "LG000000000001" });

    expect(api.fetchShipments.mock.calls[0][0]).toEqual({ status: "active", q: "LG00", page: 2 });
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/account/shipments?status=active&q=LG00");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/account/shipments?status=active&q=LG00&page=3");
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("marks the chosen filter and links the others, resetting to page one", async () => {
    searchParams.set("status", "delivered");
    searchParams.set("page", "4");
    api.fetchShipments.mockResolvedValue(paged([shipment()]));
    renderWithClient(<ShipmentsList />);
    const filters = await screen.findByRole("navigation", { name: "Filter shipments" });

    expect(within(filters).getByRole("link", { name: "Delivered" })).toHaveAttribute("aria-current", "true");
    expect(within(filters).getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    expect(within(filters).getByRole("link", { name: "In progress" })).toHaveAttribute("href", "/account/shipments?status=active");
  });

  it("searches by tracking number, keeping the filter and going back to the first page", async () => {
    searchParams.set("status", "active");
    searchParams.set("page", "3");
    api.fetchShipments.mockResolvedValue(paged([shipment()]));
    renderWithClient(<ShipmentsList />);

    await userEvent.type(await screen.findByLabelText("Search by tracking number"), "lg00");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledWith("/account/shipments?status=active&q=lg00");
  });

  it("invites a first booking when there is nothing yet", async () => {
    api.fetchShipments.mockResolvedValue(paged([]));
    renderWithClient(<ShipmentsList />);

    expect(await screen.findByText("You haven't booked a shipment yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a quote" })).toHaveAttribute("href", "/quote");
  });

  it("says no shipments match, rather than 'none yet', when a filter or search is on", async () => {
    searchParams.set("q", "ZZZ");
    api.fetchShipments.mockResolvedValue(paged([]));
    renderWithClient(<ShipmentsList />);

    expect(await screen.findByText("No shipments match.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all shipments" })).toHaveAttribute("href", "/account/shipments");
    expect(screen.queryByText(/haven't booked/)).not.toBeInTheDocument();
  });

  it("offers a retry when the list can't be loaded", async () => {
    api.fetchShipments.mockRejectedValueOnce(new ApiError(0, "network", "x")).mockResolvedValue(paged([shipment()]));
    renderWithClient(<ShipmentsList />);

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "LG000000000001" })).toBeInTheDocument();
  });

  it("uses a different tone for cancelled shipments but always shows the words", async () => {
    api.fetchShipments.mockResolvedValue(paged([shipment({ status: "cancelled", status_label: "Cancelled", total: money(100) })]));
    renderWithClient(<ShipmentsList />);

    const row = (await screen.findByRole("link", { name: "LG000000000001" })).closest("li")!;
    expect(within(row).getByText("Cancelled")).toHaveClass("bg-red-100");
  });
});
