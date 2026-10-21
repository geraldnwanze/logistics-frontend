import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shipmentFiltersFrom, shipmentsHref } from "@/components/admin/shipments-queue";
import { ShipmentScreen, ShipmentsScreen } from "@/components/admin/screens";
import { toUpdate, validateUpdate } from "@/components/admin/tracking-update-form";
import * as shipmentsApi from "@/lib/admin/shipments";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import * as shippingApi from "@/lib/shipping/api";
import * as download from "@/lib/shipping/download";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { OPS, shipmentDetail, shipmentRow, staff } from "./admin-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/shipments" }));
vi.mock("@/lib/admin/shipments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/shipments")>();

  return { ...real, fetchAdminShipments: vi.fn(), fetchAdminShipment: vi.fn(), fetchShipmentAssignees: vi.fn(), assignShipment: vi.fn(), addShipmentNote: vi.fn(), addTrackingEvent: vi.fn(), cancelShipmentAsStaff: vi.fn(), refundShipment: vi.fn(), uploadDeliveryProof: vi.fn() };
});
vi.mock("@/lib/auth/api");
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/shipping/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shipping/download")>()), openSignedLink: vi.fn() }));

const api = vi.mocked(shipmentsApi);
const auth = vi.mocked(authApi);
const page = <T,>(items: T[], over: Partial<{ page: number; lastPage: number; total: number; searchLimited: string | null }> = {}) => ({ items, page: 1, lastPage: 1, total: items.length, searchLimited: null, ...over });
const COLLEAGUES = [{ id: "01STAFF", name: "Sam Staff" }, { id: "01BEA", name: "Bea Booker" }];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  auth.fetchCurrentUser.mockResolvedValue(staff(OPS));
  api.fetchShipmentAssignees.mockResolvedValue(COLLEAGUES);
});

describe("filters in the address", () => {
  it("reads only values the API knows", () => {
    const v = shipmentFiltersFrom(new URLSearchParams("q=%20LG1%20&stage=delayed&assigned_to=me&order=updated&page=2"));

    expect(v).toEqual({ q: "LG1", stage: "delayed", assigned_to: "me", order: "updated", page: 2 });
    expect(shipmentFiltersFrom(new URLSearchParams("stage=bogus&assigned_to=01X&order=sideways"))).toMatchObject({ stage: undefined, assigned_to: undefined, order: undefined });
    expect(shipmentFiltersFrom(new URLSearchParams("assigned_to=01BEA0000000000000000000AA")).assigned_to).toBe("01BEA0000000000000000000AA");
  });

  it("builds the address back, leaving out defaults", () => {
    expect(shipmentsHref({})).toBe("/admin/shipments");
    expect(shipmentsHref({ stage: "exceptions", order: "oldest", q: "a b" }, 3)).toBe("/admin/shipments?q=a+b&stage=exceptions&order=oldest&page=3");
  });
});

describe("the tracking form's rules", () => {
  const base = { status: "in_transit", when: "", description: "", internal: "", isPublic: true, reason: "", recipient: "", city: "", country: "", facility: "" };

  it("asks for a status, a time that has happened, a reason for an exception and a real country code", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");

    expect(validateUpdate({ ...base, status: "" }, now)).toEqual({ status: "Choose the status to move the shipment to." });
    expect(validateUpdate({ ...base, when: "2026-10-16T14:00" }, now).when).toMatch(/not in the future/);
    expect(validateUpdate({ ...base, when: "2026-10-16T11:00" }, now)).toEqual({});
    expect(validateUpdate({ ...base, status: "exception" }, now).reason).toBe("Say what went wrong.");
    expect(validateUpdate({ ...base, country: "Germany" }, now).country).toMatch(/two-letter/);
  });

  it("sends only what was filled in, as the API expects it", () => {
    expect(toUpdate(base)).toEqual({ status: "in_transit", is_public: true });
    expect(toUpdate({ ...base, status: "exception", reason: "damaged", recipient: "ignored", city: " Frankfurt ", country: "de", description: " Crushed ", isPublic: false, when: "2026-10-16T11:00" }))
      .toEqual({ status: "exception", is_public: false, exception_code: "damaged", description: "Crushed", location: { city: "Frankfurt", country: "DE" }, occurred_at: new Date("2026-10-16T11:00").toISOString() });
    expect(toUpdate({ ...base, status: "delivered", recipient: " Hans Becker ", reason: "damaged" })).toEqual({ status: "delivered", is_public: true, recipient_name: "Hans Becker" });
  });
});

describe("shipment queue", () => {
  const open = () => renderWithClient(<ShipmentsScreen />);

  it("lists shipments with route, money, status, customer and who has it", async () => {
    api.fetchAdminShipments.mockResolvedValue(page([
      shipmentRow({ delayed: true, assignee: { id: "01BEA", name: "Bea Booker" }, assigned_to: "01BEA", facility: "LOS1" }),
      shipmentRow({ id: "S2", tracking_number: "LG000000000002", status: { code: "delivered", label: "Delivered" }, customer: null }),
    ], { total: 2 }));
    open();

    const first = (await screen.findByRole("link", { name: "LG000000000001" })).closest("li")!;
    expect(first).toHaveTextContent("Lagos, NG → Berlin, DE");
    expect(first).toHaveTextContent("$70.41");
    expect(first).toHaveTextContent("Ada Shipper (ada@example.test)");
    expect(first).toHaveTextContent("handled by Bea Booker");
    expect(within(first).getByText("Running late")).toBeInTheDocument();
    expect(within(first).getByText("In transit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LG000000000002" }).closest("li")).not.toHaveTextContent("ada@example.test");
    expect(screen.getByText("2 shipments")).toBeInTheDocument();
  });

  it("asks the API for the filters in the address and changes the address when they change", async () => {
    searchParams.set("stage", "exceptions");
    searchParams.set("order", "updated");
    api.fetchAdminShipments.mockResolvedValue(page([shipmentRow()]));
    open();
    await screen.findByRole("link", { name: "LG000000000001" });

    expect(api.fetchAdminShipments.mock.calls[0][0]).toMatchObject({ stage: "exceptions", sort: "status_changed_at", dir: "desc" });
    await userEvent.selectOptions(screen.getByLabelText("Stage"), "delayed");
    expect(replace).toHaveBeenLastCalledWith("/admin/shipments?stage=delayed&order=updated");
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "me");
    expect(replace).toHaveBeenLastCalledWith("/admin/shipments?stage=exceptions&assigned_to=me&order=updated");
    await userEvent.type(screen.getByLabelText("Search"), "LG0000");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=LG0000"));
  });

  it("offers colleagues in the assigned-to filter only to people who may assign", async () => {
    api.fetchAdminShipments.mockResolvedValue(page([shipmentRow()]));
    const view = open();
    const select = await screen.findByLabelText("Assigned to");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Bea Booker" })).toBeInTheDocument());
    expect(within(select).queryByRole("option", { name: "Sam Staff" })).not.toBeInTheDocument();   // that is "Me"
    view.unmount();

    api.fetchShipmentAssignees.mockClear();
    auth.fetchCurrentUser.mockResolvedValue(staff(["shipments.view"]));
    open();
    await screen.findByLabelText("Assigned to");
    expect(api.fetchShipmentAssignees).not.toHaveBeenCalled();
  });

  it("explains a search the person's role can't fully do", async () => {
    api.fetchAdminShipments.mockResolvedValue(page([], { searchLimited: "Searching by name or email needs the customers.view permission." }));
    open();

    expect(await screen.findByRole("note")).toHaveTextContent("needs the customers.view permission");
  });

  it("says when nothing matches and when it could not load", async () => {
    searchParams.set("stage", "returned");
    api.fetchAdminShipments.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([]));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No shipments match these filters.")).toBeInTheDocument();
  });

  it("is closed to people who may not see shipments", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(["tickets.manage"]));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchAdminShipments).not.toHaveBeenCalled();
  });
});

describe("shipment detail", () => {
  const open = (perms = OPS, detail = shipmentDetail()) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(perms));
    api.fetchAdminShipment.mockResolvedValue(detail);

    return renderWithClient(<ShipmentScreen id="S1" />);
  };

  it("shows the shipment, both parties and what is in it", async () => {
    open();

    expect(await screen.findByRole("heading", { name: "LG000000000001" })).toBeInTheDocument();
    expect(screen.getByText("Demonstration data")).toBeInTheDocument();
    expect(screen.getByText(/1 Marina Road/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ife@example.test" })).toHaveAttribute("href", "mailto:ife@example.test");
    expect(screen.getByText(/Books · billable weight 2\.00 kg · declared value \$100\.00/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Packages" })).toHaveTextContent("30 × 20 × 10 cm");
  });

  it("hides contact details from roles that may not see them, and says why", async () => {
    open(["shipments.view"], shipmentDetail({ customer: null, sender: { redacted: true, city: "Lagos", country: "NG" }, recipient: { redacted: true, city: "Berlin", country: "DE" } }));

    expect(await screen.findAllByText("Contact details are hidden for your role.")).toHaveLength(2);
    expect(screen.queryByText(/Marina Road/)).not.toBeInTheDocument();
  });

  it("shows the full history with internal notes, sources, and events that were not applied", async () => {
    open();

    const list = await screen.findByRole("list", { name: "Tracking events" });
    const [latest, , oldest] = Array.from(list.children) as HTMLElement[];
    expect(latest).toHaveTextContent("Delivered");
    expect(latest).toHaveTextContent("Not applied");
    expect(latest).toHaveTextContent("Out of order: arrived before it left.");
    expect(oldest).toHaveTextContent("Internal: Driver: Tunde");
    expect(oldest).toHaveTextContent("Staff");
    expect(Array.from(list.children)[1]).toHaveTextContent("Carrier");
  });

  it("assigns to a colleague, and back to nobody", async () => {
    api.assignShipment.mockResolvedValueOnce(shipmentRow({ assigned_to: "01BEA", assignee: { id: "01BEA", name: "Bea Booker" } })).mockResolvedValueOnce(shipmentRow());
    open();

    const select = await screen.findByLabelText("Assigned to");
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Nobody", "Sam Staff (you)", "Bea Booker"]));
    await userEvent.selectOptions(select, "Bea Booker");
    await waitFor(() => expect(api.assignShipment).toHaveBeenLastCalledWith("S1", "01BEA"));
    expect(await screen.findByText("Assigned to Bea Booker.")).toBeInTheDocument();

    await userEvent.selectOptions(select, "Nobody");
    await waitFor(() => expect(api.assignShipment).toHaveBeenLastCalledWith("S1", null));
    expect(await screen.findByText("Unassigned.")).toBeInTheDocument();
  });

  it("shows who has it, read-only, when the person may not assign", async () => {
    open(["shipments.view"], shipmentDetail({ assigned_to: "01BEA", assignee: { id: "01BEA", name: "Bea Booker" } }));

    expect(await screen.findByText("Bea Booker is handling this.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Assigned to")).not.toBeInTheDocument();
  });

  it("adds an internal note, only for people who may", async () => {
    api.addShipmentNote.mockResolvedValue(undefined);
    const view = open();
    await userEvent.type(await screen.findByLabelText(/^Add a note \(never/), "Called the sender.");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(api.addShipmentNote).toHaveBeenCalledWith("S1", "Called the sender."));
    expect(await screen.findByText("Note added.")).toBeInTheDocument();
    view.unmount();

    open(["shipments.view"], shipmentDetail({ notes: [{ id: 1, body: "Existing note", created_at: "2026-10-16T09:00:00Z" }] }));
    expect(await screen.findByText("Existing note")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Add a note \(never/)).not.toBeInTheDocument();
  });

  it("downloads documents through a signed link", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    open(OPS, shipmentDetail({ documents: [{ id: "D1", type: "commercial_invoice", name: "invoice.pdf", size: 9000, generated: true, event: null }] }));

    await userEvent.click(await screen.findByRole("button", { name: /Download invoice\.pdf/ }));
    vi.mocked(shippingApi.fetchDocumentLink).mockResolvedValue({ url: "x" });
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();

    expect(shippingApi.fetchDocumentLink).toHaveBeenCalledWith("S1", "D1");
  });

  it("copes with a shipment that is gone", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(OPS));
    api.fetchAdminShipment.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<ShipmentScreen id="S1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this shipment");
  });

  describe("adding a tracking update", () => {
    const fill = async (status: string) => userEvent.selectOptions(await screen.findByLabelText("Move the shipment to"), status);

    it("offers only the statuses the shipment can move to, and only to people who may", async () => {
      const view = open();
      const select = await screen.findByLabelText("Move the shipment to");
      expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a status…", "Arrived in destination country", "Exception", "Delivered"]);
      view.unmount();

      open(["shipments.view"]);
      await screen.findByRole("heading", { name: "LG000000000001" });
      expect(screen.queryByLabelText("Move the shipment to")).not.toBeInTheDocument();
    });

    it("says so when the shipment is at a final status", async () => {
      const detail = shipmentDetail();
      open(OPS, { ...detail, tracking: { ...detail.tracking, allowed_next: [] } });

      expect(await screen.findByText(/final status, so it can't be moved by hand/)).toBeInTheDocument();
    });

    it("checks the form first, then asks to confirm, then sends exactly what was entered", async () => {
      api.addTrackingEvent.mockResolvedValue(shipmentDetail().tracking);
      open();
      await userEvent.click(await screen.findByRole("button", { name: "Review update" }));
      expect(screen.getByText("Choose the status to move the shipment to.")).toBeInTheDocument();

      await fill("Arrived in destination country");
      await userEvent.type(screen.getByLabelText("City"), "Frankfurt");
      await userEvent.type(screen.getByLabelText("Country code"), "de");
      await userEvent.type(screen.getByLabelText("Message for the customer"), "Landed at Frankfurt.");
      await userEvent.click(screen.getByRole("button", { name: "Review update" }));

      expect(screen.getByRole("group", { name: "Confirm update" })).toHaveTextContent("The customer will see this and may be notified.");
      expect(api.addTrackingEvent).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Yes, add the update" }));

      await waitFor(() => expect(api.addTrackingEvent).toHaveBeenCalledWith("S1", { status: "arrived_destination_country", is_public: true, description: "Landed at Frankfurt.", location: { city: "Frankfurt", country: "DE" } }));
      expect(await screen.findByText("Tracking updated.")).toBeInTheDocument();
      expect(screen.getByLabelText("Move the shipment to")).toHaveValue("");
    });

    it("asks for a reason on an exception and for who received a delivery", async () => {
      open();
      await fill("Exception");
      await userEvent.click(screen.getByRole("button", { name: "Review update" }));
      expect(screen.getByText("Say what went wrong.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Received by")).not.toBeInTheDocument();

      await fill("Delivered");
      expect(screen.getByLabelText("Received by")).toBeInTheDocument();
      expect(screen.queryByLabelText("What went wrong")).not.toBeInTheDocument();
    });

    it("says a private update stays private", async () => {
      open();
      await fill("Delivered");
      await userEvent.click(screen.getByLabelText("Show this update to the customer"));
      await userEvent.click(screen.getByRole("button", { name: "Review update" }));

      expect(screen.getByRole("group", { name: "Confirm update" })).toHaveTextContent("Only staff will see this.");
    });

    it("shows the API's reason when the move is refused, and keeps the form", async () => {
      api.addTrackingEvent.mockRejectedValue(new ApiError(422, "invalid_transition", "A shipment that is “In transit” cannot be moved to “Delivered” by hand."));
      open();
      await fill("Delivered");
      await userEvent.click(screen.getByRole("button", { name: "Review update" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, add the update" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("cannot be moved to “Delivered” by hand");
      expect(screen.getByLabelText("Move the shipment to")).toHaveValue("delivered");
      expect(screen.queryByRole("group", { name: "Confirm update" })).not.toBeInTheDocument();
    });

    it("lets go back from the confirmation without sending", async () => {
      open();
      await fill("Delivered");
      await userEvent.click(screen.getByRole("button", { name: "Review update" }));
      await userEvent.click(screen.getByRole("button", { name: "Go back" }));

      expect(api.addTrackingEvent).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Review update" })).toBeInTheDocument();
    });
  });
});

describe("cancelling, refunding and proof of delivery", () => {
  const FULL = [...OPS, "refunds.approve"];
  const open = (perms = FULL, detail = shipmentDetail()) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(perms));
    api.fetchAdminShipment.mockResolvedValue(detail);

    return renderWithClient(<ShipmentScreen id="S1" />);
  };
  const cancellable = (over = {}) => shipmentDetail({ cancellable: true, status: { code: "booking_confirmed", label: "Booking confirmed" }, ...over });

  describe("cancelling", () => {
    it("is offered before collection, and says the customer will be refunded", async () => {
      open(FULL, cancellable());

      const panel = await screen.findByRole("region", { name: "Cancel this shipment" });
      expect(panel).toHaveTextContent("refunded $70.41 to their original payment method");
    });

    it("says nothing needs refunding for an unpaid booking", async () => {
      open(FULL, cancellable({ invoice: { ...shipmentDetail().invoice!, status: "issued", refundable_minor: 0 } }));

      expect(await screen.findByText(/No payment needs refunding\./)).toBeInTheDocument();
    });

    it("is not offered once collected, to people who may not update shipments, or after cancelling", async () => {
      const view = open(FULL, shipmentDetail());
      await screen.findByRole("heading", { name: "LG000000000001" });
      expect(screen.queryByRole("region", { name: "Cancel this shipment" })).not.toBeInTheDocument();
      view.unmount();

      open(["shipments.view"], cancellable());
      await screen.findByRole("heading", { name: "LG000000000001" });
      expect(screen.queryByRole("region", { name: "Cancel this shipment" })).not.toBeInTheDocument();
    });

    it("shows why a shipment was cancelled", async () => {
      open(FULL, shipmentDetail({ status: { code: "cancelled", label: "Cancelled" }, cancellation_reason: "Customer phoned to cancel" }));

      expect(await screen.findByText(/This shipment was cancelled: Customer phoned to cancel\./)).toBeInTheDocument();
    });

    it("needs a reason, asks first, and cancels once confirmed", async () => {
      api.cancelShipmentAsStaff.mockResolvedValue(undefined);
      open(FULL, cancellable());
      expect(await screen.findByRole("button", { name: "Review cancellation" })).toBeDisabled();

      await userEvent.type(screen.getByLabelText(/Reason \(the customer will see this\)/), "Customer phoned to cancel");
      await userEvent.click(screen.getByRole("button", { name: "Review cancellation" }));
      expect(screen.getByRole("group", { name: "Confirm cancellation" })).toHaveTextContent("refund $70.41");
      await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
      expect(api.cancelShipmentAsStaff).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Review cancellation" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));
      await waitFor(() => expect(api.cancelShipmentAsStaff).toHaveBeenCalledWith("S1", "Customer phoned to cancel"));
    });

    it("explains it when the shipment was collected meanwhile, and reloads", async () => {
      api.cancelShipmentAsStaff.mockRejectedValue(new ApiError(409, "shipment_collected", "This shipment has already been collected and can no longer be cancelled here."));
      open(FULL, cancellable());
      await userEvent.type(await screen.findByLabelText(/Reason \(the customer will see this\)/), "Too late");
      await userEvent.click(screen.getByRole("button", { name: "Review cancellation" }));
      api.fetchAdminShipment.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("already been collected");
      await waitFor(() => expect(api.fetchAdminShipment).toHaveBeenCalled());
    });

    it("says the shipment is still booked when the refund fails", async () => {
      api.cancelShipmentAsStaff.mockRejectedValue(new ApiError(502, "refund_failed", "x"));
      open(FULL, cancellable());
      await userEvent.type(await screen.findByLabelText(/Reason \(the customer will see this\)/), "Test");
      await userEvent.click(screen.getByRole("button", { name: "Review cancellation" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was changed; you can try again.");
    });
  });

  describe("refunding", () => {
    const paid = (over = {}) => shipmentDetail({ invoice: { ...shipmentDetail().invoice!, total_minor: 7041, refunded_minor: 1000, refundable_minor: 6041, ...over } });

    it("shows what was paid, refunded and is still refundable, only to people who may refund", async () => {
      const view = open(FULL, paid());
      expect(await screen.findByText(/Paid \$70\.41; already refunded \$10\.00; still refundable \$60\.41\./)).toBeInTheDocument();
      view.unmount();

      open(OPS, paid());
      await screen.findByRole("heading", { name: "LG000000000001" });
      expect(screen.queryByRole("region", { name: "Refund" })).not.toBeInTheDocument();
    });

    it("has no refund panel when nothing is refundable", async () => {
      open(FULL, paid({ refundable_minor: 0, refunded_minor: 7041 }));
      await screen.findByRole("heading", { name: "LG000000000001" });

      expect(screen.queryByRole("region", { name: "Refund" })).not.toBeInTheDocument();
    });

    it("refuses an amount that is too much, nothing, or half a cent, and needs a reason", async () => {
      open(FULL, paid());
      const amount = await screen.findByLabelText("Amount (USD)");
      expect(screen.getByRole("button", { name: "Review refund" })).toBeDisabled();

      await userEvent.type(amount, "70.00");
      expect(screen.getByText("At most $60.41 can still be refunded.")).toBeInTheDocument();
      await userEvent.clear(amount);
      await userEvent.type(amount, "0");
      expect(screen.getByText("The amount must be more than zero.")).toBeInTheDocument();
      await userEvent.clear(amount);
      await userEvent.type(amount, "5.005");
      expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
      await userEvent.clear(amount);
      await userEvent.type(amount, "5.00");
      expect(screen.getByRole("button", { name: "Review refund" })).toBeDisabled();   // still no reason
      await userEvent.type(screen.getByLabelText("Reason"), "Goodwill");
      expect(screen.getByRole("button", { name: "Review refund" })).toBeEnabled();
    });

    it("refunds a part after confirming, sending the amount as entered", async () => {
      api.refundShipment.mockResolvedValue(undefined);
      open(FULL, paid());
      await userEvent.type(await screen.findByLabelText("Amount (USD)"), "5.00");
      await userEvent.type(screen.getByLabelText("Reason"), "Goodwill");

      await userEvent.click(screen.getByRole("button", { name: "Review refund" }));
      expect(screen.getByRole("group", { name: "Confirm refund" })).toHaveTextContent("Refund $5.00 to the customer's original payment method?");
      expect(api.refundShipment).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Yes, refund" }));

      await waitFor(() => expect(api.refundShipment).toHaveBeenCalledWith("S1", { amount: "5.00", reason: "Goodwill" }, expect.any(String)));
      expect(await screen.findByText("Refunded $5.00.")).toBeInTheDocument();
    });

    it("refunds everything still refundable when the amount is left blank", async () => {
      api.refundShipment.mockResolvedValue(undefined);
      open(FULL, paid());
      await userEvent.type(await screen.findByLabelText("Reason"), "Service failure");

      await userEvent.click(screen.getByRole("button", { name: "Review refund" }));
      expect(screen.getByRole("group", { name: "Confirm refund" })).toHaveTextContent("Refund $60.41");
      await userEvent.click(screen.getByRole("button", { name: "Yes, refund" }));

      await waitFor(() => expect(api.refundShipment).toHaveBeenCalledWith("S1", { reason: "Service failure" }, expect.any(String)));
    });

    it("retries the same refund under the same key, and a changed one under a new key", async () => {
      api.refundShipment.mockRejectedValue(new ApiError(0, "network", "x"));
      open(FULL, paid());
      await userEvent.type(await screen.findByLabelText("Reason"), "Goodwill");
      const attempt = async () => { await userEvent.click(screen.getByRole("button", { name: "Review refund" })); await userEvent.click(screen.getByRole("button", { name: "Yes, refund" })); await screen.findByRole("alert"); };

      await attempt();
      await attempt();
      await userEvent.type(screen.getByLabelText("Amount (USD)"), "1.00");
      await attempt();

      expect(api.refundShipment).toHaveBeenCalledTimes(3);
      const keys = api.refundShipment.mock.calls.map((c) => c[2]);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[0]);
    });

    it.each([
      ["no_payment_to_refund", "no online payment on this invoice"],
      ["nothing_to_refund", "hasn't been paid"],
      ["refund_failed", "couldn't process the refund"],
    ])("explains %s", async (code, text) => {
      api.refundShipment.mockRejectedValue(new ApiError(409, code, "x"));
      open(FULL, paid());
      await userEvent.type(await screen.findByLabelText("Reason"), "Goodwill");
      await userEvent.click(screen.getByRole("button", { name: "Review refund" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, refund" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(text);
    });

    it("shows the API's own amount when someone else refunded first", async () => {
      api.refundShipment.mockRejectedValue(new ApiError(422, "refund_exceeds_balance", "At most 20.00 USD can still be refunded."));
      open(FULL, paid());
      await userEvent.type(await screen.findByLabelText("Amount (USD)"), "50.00");
      await userEvent.type(screen.getByLabelText("Reason"), "Goodwill");
      await userEvent.click(screen.getByRole("button", { name: "Review refund" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, refund" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("At most 20.00 USD can still be refunded.");
    });
  });

  describe("proof of delivery", () => {
    const delivered = (over = {}) => {
      const base = shipmentDetail();

      return shipmentDetail({ status: { code: "delivered", label: "Delivered" }, tracking: { ...base.tracking, allowed_next: [], events: [{ ...base.tracking.events[2], applied: true, rejection_reason: null }, base.tracking.events[0]] }, ...over });
    };
    const file = (name: string, type = "image/jpeg") => new File(["x"], name, { type });

    it("offers an upload on a delivery event, not on others or on events that were not applied", async () => {
      open(FULL, shipmentDetail());   // its delivered event was not applied
      await screen.findByRole("heading", { name: "LG000000000001" });
      expect(screen.queryByRole("button", { name: "Attach proof of delivery" })).not.toBeInTheDocument();
    });

    it("lists the files already attached to the delivery, with downloads", async () => {
      vi.mocked(download.openSignedLink).mockResolvedValue(null);
      open(FULL, delivered({ documents: [{ id: "P1", type: "proof_of_delivery", name: "doorstep.jpg", size: 1000, generated: false, event: "E3" }, { id: "D9", type: "other", name: "other.pdf", size: 1, generated: false, event: null }] }));

      const files = await screen.findByRole("list", { name: "Proof of delivery files" });
      expect(files).toHaveTextContent("doorstep.jpg");
      expect(files).not.toHaveTextContent("other.pdf");
      await userEvent.click(within(files).getByRole("button", { name: /Download doorstep\.jpg/ }));
      vi.mocked(shippingApi.fetchDocumentLink).mockResolvedValue({ url: "x" });
      await vi.mocked(download.openSignedLink).mock.calls[0][0]();
      expect(shippingApi.fetchDocumentLink).toHaveBeenCalledWith("S1", "P1");
    });

    it("sends the chosen photo for that event", async () => {
      api.uploadDeliveryProof.mockResolvedValue(undefined);
      open(FULL, delivered());
      await screen.findByText("Nothing attached yet.");
      const photo = file("doorstep.jpg");

      await userEvent.upload(screen.getByTestId("proof-input"), photo);

      await waitFor(() => expect(api.uploadDeliveryProof).toHaveBeenCalledWith("S1", "E3", photo));
      expect(await screen.findByText("doorstep.jpg was attached.")).toBeInTheDocument();
    });

    it("turns away a wrong type before sending, and shows the server's refusal", async () => {
      api.uploadDeliveryProof.mockRejectedValue(new ApiError(422, "unsupported_media_type", "Only PDF, JPEG and PNG documents are accepted."));
      open(FULL, delivered());
      await screen.findByText("Nothing attached yet.");

      await userEvent.upload(screen.getByTestId("proof-input"), file("setup.exe", "application/octet-stream"), { applyAccept: false });
      expect(screen.getByRole("alert")).toHaveTextContent("“setup.exe”: Only PDF, JPEG and PNG files are accepted.");
      expect(api.uploadDeliveryProof).not.toHaveBeenCalled();

      await userEvent.upload(screen.getByTestId("proof-input"), file("fake.jpg"));
      expect(await screen.findByText("Only PDF, JPEG and PNG documents are accepted.")).toBeInTheDocument();
    });

    it("lets people without tracking access see the proof but not add to it", async () => {
      open(["shipments.view"], delivered({ documents: [{ id: "P1", type: "proof_of_delivery", name: "doorstep.jpg", size: 1000, generated: false, event: "E3" }] }));

      expect(await screen.findByRole("list", { name: "Proof of delivery files" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Attach proof of delivery" })).not.toBeInTheDocument();
    });
  });
});
