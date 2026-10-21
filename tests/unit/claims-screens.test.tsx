import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimDetail } from "@/components/claims/claim-detail";
import { ClaimForm, validateClaim } from "@/components/claims/claim-form";
import { ClaimsList } from "@/components/claims/claims-list";
import { ShipmentView } from "@/components/booking/shipment-view";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import * as supportApi from "@/lib/support/api";
import { claimStatus } from "@/lib/support/labels";
import { claimShipmentFor, rememberClaimShipment, rememberTicketToken, ticketTokenFor } from "@/lib/support/tokens";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { money, paged, shipment } from "./shipping-fixtures";
import { claim, limits } from "./support-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/support/api");
vi.mock("@/lib/shipping/api");

const api = vi.mocked(supportApi);
const ship = vi.mocked(shippingApi);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  api.fetchClaimLimits.mockResolvedValue(limits());
  ship.fetchShipment.mockResolvedValue(shipment({ status: "delivered", status_label: "Delivered", created_at: "2026-10-10T08:00:00Z" }));
});

afterEach(() => vi.useRealTimers());

describe("claimStatus", () => {
  it.each([["submitted", "Received"], ["under_review", "Under review"], ["info_requested", "We need more information"], ["approved", "Approved"], ["rejected", "Not approved"], ["paid", "Paid"], ["closed", "Closed"], ["withdrawn", "Withdrawn"]])("describes %s as %s with a sentence about what it means", (status, text) => {
    const s = claimStatus(status);

    expect(s.text).toBe(text);
    expect(s.explain.length).toBeGreaterThan(10);
  });
});

describe("validateClaim", () => {
  const bounds = { min: "2026-10-10", max: "2026-10-16" };
  const ok = { amount: "20.00", incident: "2026-10-15", description: "The box arrived crushed.", email: "" };

  it("accepts a good claim", () => {
    expect(validateClaim(ok, "damage", limits(), bounds, false)).toEqual({});
  });

  it("insists on a type", () => {
    expect(validateClaim(ok, null, limits(), bounds, false)).toHaveProperty("type");
  });

  it.each([["", /Enter the amount/], ["abc", /decimal places/], ["20.123", /decimal places/], ["0", /more than zero/], ["70.42", /most this shipment is covered for is .*70\.41/], ["999999", /most this shipment/]])("rejects amount %j", (amount, message) => {
    expect(validateClaim({ ...ok, amount }, "damage", limits(), bounds, false).amount).toMatch(message);
  });

  it("accepts exactly the cap, to the cent", () => {
    expect(validateClaim({ ...ok, amount: "70.41" }, "damage", limits(), bounds, false)).toEqual({});
  });

  it("respects currencies without decimals", () => {
    const yen = limits({ currency: "JPY", decimals: 0, cap: { amount_minor: 5000, amount: "5000", currency: "JPY" } });

    expect(validateClaim({ ...ok, amount: "5000" }, "damage", yen, bounds, false)).toEqual({});
    expect(validateClaim({ ...ok, amount: "4999.5" }, "damage", yen, bounds, false)).toHaveProperty("amount");
  });

  it.each([["", /Choose the date/], ["2026-10-17", /future/], ["2026-10-09", /before you booked/]])("rejects date %j", (incident, message) => {
    expect(validateClaim({ ...ok, incident }, "damage", limits(), bounds, false).incident).toMatch(message);
  });

  it("wants at least ten characters of explanation, and a valid email only if one is given", () => {
    expect(validateClaim({ ...ok, description: "broken" }, "damage", limits(), bounds, false)).toHaveProperty("description");
    expect(validateClaim({ ...ok, email: "nope" }, "damage", limits(), bounds, false)).toHaveProperty("email");
    expect(validateClaim({ ...ok, email: "nope" }, "damage", limits(), bounds, true)).toEqual({});
  });
});

describe("ClaimForm", () => {
  const complete = async () => {
    await userEvent.type(await screen.findByLabelText(/Amount you are claiming/), "20.00");
    await userEvent.type(screen.getByLabelText("What happened?"), "The box arrived crushed and the items inside broke.");
  };

  it("offers only what can be claimed, and says why the rest can't", async () => {
    renderWithClient(<ClaimForm shipmentId="S1" />);

    expect(await screen.findByLabelText("Damaged goods")).toBeEnabled();
    expect(screen.getByLabelText("Something else")).toBeEnabled();
    expect(screen.getByLabelText("Lost shipment")).toBeDisabled();
    expect(screen.getByLabelText("Lost shipment")).toHaveAccessibleDescription("A delivered shipment cannot be claimed as lost.");
    expect(screen.getByLabelText("Late delivery")).toBeDisabled();
    expect(screen.getByLabelText("Damaged goods")).toBeChecked();
  });

  it("explains the most it can pay, and why", async () => {
    const first = renderWithClient(<ClaimForm shipmentId="S1" />);
    expect(await screen.findByText(/covered for up to/)).toHaveTextContent("70.41");
    expect(screen.getByText(/because the shipment wasn't insured/)).toBeInTheDocument();
    expect(screen.getByText(/within 30 days of delivery/)).toBeInTheDocument();
    first.unmount();

    api.fetchClaimLimits.mockResolvedValue(limits({ insured: true, cap: money(17041) }));
    renderWithClient(<ClaimForm shipmentId="S1" />);
    expect(await screen.findByText(/because you insured it/)).toBeInTheDocument();
  });

  it("files the claim and opens it, remembering which shipment a guest filed it on", async () => {
    api.fileClaim.mockResolvedValue(claim());
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await complete();
    await userEvent.click(screen.getByLabelText("Something else"));

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/claims/C1"));
    expect(api.fileClaim).toHaveBeenCalledWith("S1", expect.objectContaining({ type: "other", claimed_amount: "20.00", description: "The box arrived crushed and the items inside broke." }), []);
    expect(claimShipmentFor("C1")).toBe("S1");
  });

  it("limits the date to between booking and today", async () => {
    renderWithClient(<ClaimForm shipmentId="S1" />);

    const date = await screen.findByLabelText("Date it happened");

    expect(date).toHaveAttribute("min", "2026-10-10");
    expect(date).toHaveAttribute("max", new Date().toISOString().slice(0, 10));
  });

  it("stops an over-limit amount before sending, stating the limit", async () => {
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await userEvent.type(await screen.findByLabelText(/Amount you are claiming/), "500");
    await userEvent.type(screen.getByLabelText("What happened?"), "The box arrived crushed and the items inside broke.");

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    expect(screen.getByLabelText(/Amount you are claiming/)).toHaveAccessibleDescription(/most this shipment is covered for is .*70\.41/);
    expect(api.fileClaim).not.toHaveBeenCalled();
  });

  it("says no claim can be made, and offers support, when nothing is eligible", async () => {
    api.fetchClaimLimits.mockResolvedValue(limits({ eligibility: { loss: { eligible: false, reason: "Not late yet." }, damage: { eligible: false, reason: "Damage can be claimed once the shipment is delivered." }, delay: { eligible: false, reason: "Not late yet." }, other: { eligible: false, reason: "Claims can only be made once a shipment has been collected." } } }));
    renderWithClient(<ClaimForm shipmentId="S1" />);

    expect(await screen.findByText(/can't make a claim on this shipment right now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit claim" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /support/i })[0]).toHaveAttribute("href", expect.stringContaining("/support?shipment=LG000000000001&ref=S1"));
  });

  it("explains a duplicate or newly ineligible claim and refreshes what's allowed", async () => {
    api.fileClaim.mockRejectedValue(new ApiError(409, "claim_exists", "There is already an open claim of this type for this shipment."));
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await complete();

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already an open claim");
    await waitFor(() => expect(api.fetchClaimLimits.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows the API's field errors beside the field", async () => {
    api.fileClaim.mockRejectedValue(new ApiError(422, "validation_failed", "x", { claimed_amount: ["The amount must be more than 0 and at most 70.41 USD."] }));
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await complete();

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    expect(await screen.findByText(/must be more than 0 and at most 70\.41 USD/)).toBeInTheDocument();
  });

  it("asks a guest, but not a customer, for an optional email", async () => {
    renderWithClient(<ClaimForm shipmentId="S1" />);

    expect(await screen.findByLabelText("Email (optional)")).toBeInTheDocument();
  });

  it("says when the shipment can't be found", async () => {
    api.fetchClaimLimits.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<ClaimForm shipmentId="S1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("same browser tab you booked in");
  });
});

describe("ClaimDetail", () => {
  it("shows the claim, what it means, and the money", async () => {
    api.fetchClaim.mockResolvedValue(claim({ status: "approved", approved: money(1500), resolution_note: "Approved for the damaged items." }));
    renderWithClient(<ClaimDetail id="C1" />);

    expect(await screen.findByRole("heading", { name: "Damaged goods" })).toBeInTheDocument();
    expect(screen.getByText("Approved", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/claim was approved/)).toBeInTheDocument();
    expect(screen.getByText("You claimed").nextElementSibling).toHaveTextContent("20.00");
    expect(screen.getByText("Approved", { selector: "dt" }).nextElementSibling).toHaveTextContent("15.00");
    expect(screen.getByText("Approved for the damaged items.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/track/LG000000000001");
  });

  it("makes a request for information impossible to miss and lets the customer reply", async () => {
    api.fetchClaim.mockResolvedValue(claim({ status: "info_requested", notes: [{ from: "staff", body: "Please send a photo of the box.", created_at: "2026-10-16T10:00:00Z", attachments: [] }] }));
    api.addClaimNote.mockResolvedValue(claim({ status: "under_review", notes: [{ from: "staff", body: "Please send a photo of the box.", created_at: "2026-10-16T10:00:00Z", attachments: [] }, { from: "customer", body: "The box is in the photo.", created_at: "2026-10-16T11:00:00Z", attachments: [] }] }));
    renderWithClient(<ClaimDetail id="C1" />);

    expect(await screen.findByText(/read our message below/)).toBeInTheDocument();
    expect(screen.getByText("Claims team")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your reply"), "The box is in the photo.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(api.addClaimNote).toHaveBeenCalledWith("C1", "The box is in the photo.", []);
    expect(await screen.findByText("The box is in the photo.")).toBeInTheDocument();
    expect(screen.getByText("Under review", { selector: "span" })).toBeInTheDocument();
  });

  it.each(["paid", "rejected", "closed"])("takes no new messages once the claim is %s", async (status) => {
    api.fetchClaim.mockResolvedValue(claim({ status, resolution_note: status === "rejected" ? "Outside the claim window." : null }));
    renderWithClient(<ClaimDetail id="C1" />);

    await screen.findByRole("heading", { name: "Damaged goods" });
    expect(screen.queryByLabelText(/Add a message|Your reply/)).not.toBeInTheDocument();
  });

  it("says why a claim wasn't approved", async () => {
    api.fetchClaim.mockResolvedValue(claim({ status: "rejected", resolution_note: "Outside the claim window." }));
    renderWithClient(<ClaimDetail id="C1" />);

    expect(await screen.findByText("Why we couldn't approve it")).toBeInTheDocument();
    expect(screen.getByText("Outside the claim window.")).toBeInTheDocument();
  });

  it("explains a claim that finished while the customer was typing", async () => {
    api.fetchClaim.mockResolvedValue(claim());
    api.addClaimNote.mockRejectedValue(new ApiError(409, "conflict", "This claim is finished."));
    renderWithClient(<ClaimDetail id="C1" />);

    await userEvent.type(await screen.findByLabelText("Add a message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("claim is finished");
  });

  describe("withdrawing a claim", () => {
    it.each(["submitted", "under_review", "info_requested"])("is offered while the claim is %s", async (status) => {
      api.fetchClaim.mockResolvedValue(claim({ status }));
      renderWithClient(<ClaimDetail id="C1" />);

      expect(await screen.findByRole("button", { name: "Withdraw this claim" })).toBeInTheDocument();
    });

    it.each(["approved", "rejected", "paid", "closed", "withdrawn"])("is not offered once the claim is %s", async (status) => {
      api.fetchClaim.mockResolvedValue(claim({ status }));
      renderWithClient(<ClaimDetail id="C1" />);

      await screen.findByText(/CLM-2026-000001/);
      expect(screen.queryByRole("button", { name: "Withdraw this claim" })).not.toBeInTheDocument();
    });

    it("asks first, and keeping the claim changes nothing", async () => {
      api.fetchClaim.mockResolvedValue(claim());
      renderWithClient(<ClaimDetail id="C1" />);

      await userEvent.click(await screen.findByRole("button", { name: "Withdraw this claim" }));
      expect(screen.getByRole("group", { name: "Confirm withdrawing" })).toHaveTextContent("You can file a new one later");
      await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

      expect(api.withdrawClaim).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Withdraw this claim" })).toBeInTheDocument();
    });

    it("withdraws it, shows the new status and stops taking messages", async () => {
      api.fetchClaim.mockResolvedValue(claim());
      api.withdrawClaim.mockResolvedValue(claim({ status: "withdrawn" }));
      renderWithClient(<ClaimDetail id="C1" />);

      await userEvent.click(await screen.findByRole("button", { name: "Withdraw this claim" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw it" }));

      expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
      expect(api.withdrawClaim).toHaveBeenCalledWith("C1");
      expect(screen.queryByLabelText("Add a message")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Withdraw this claim" })).not.toBeInTheDocument();
    });

    it("explains it when a decision was made first", async () => {
      api.fetchClaim.mockResolvedValue(claim());
      api.withdrawClaim.mockRejectedValue(new ApiError(409, "claim_state", "Only a claim that has not been decided can be withdrawn."));
      renderWithClient(<ClaimDetail id="C1" />);

      await userEvent.click(await screen.findByRole("button", { name: "Withdraw this claim" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw it" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("already been decided");
    });
  });

  it("shows a missing claim helpfully", async () => {
    api.fetchClaim.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<ClaimDetail id="C1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("same browser tab");
  });
});

describe("ClaimsList", () => {
  it("lists claims with type, status, shipment and amount", async () => {
    api.fetchClaims.mockResolvedValue(paged([claim(), claim({ id: "C2", number: "CLM-2026-000002", type: "loss", status: "info_requested" })]));
    renderWithClient(<ClaimsList />);

    const row = (await screen.findByRole("link", { name: "Damaged goods" })).closest("li")!;
    expect(row).toHaveTextContent("CLM-2026-000001");
    expect(row).toHaveTextContent("Received");
    expect(row).toHaveTextContent("20.00");
    expect(screen.getByRole("link", { name: "Lost shipment" })).toHaveAttribute("href", "/claims/C2");
    expect(screen.getByRole("link", { name: "Lost shipment" }).closest("li")).toHaveTextContent("We need more information");
  });

  it("explains how to start a claim when there are none", async () => {
    api.fetchClaims.mockResolvedValue(paged([]));
    renderWithClient(<ClaimsList />);

    expect(await screen.findByText("You haven't made any claims.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "your shipments" })).toHaveAttribute("href", "/account/shipments");
  });

  it("pages and retries", async () => {
    searchParams.set("page", "2");
    api.fetchClaims.mockRejectedValueOnce(new ApiError(500, "server_error", "x")).mockResolvedValue(paged([claim()], { page: 2, lastPage: 2, total: 21 }));
    renderWithClient(<ClaimsList />);

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "Previous" })).toHaveAttribute("href", "/account/claims");
  });
});

describe("support tokens", () => {
  it("keeps a guest's ticket token and claim mapping in the tab only", () => {
    rememberTicketToken("T1", "tok");
    rememberClaimShipment("C1", "S1");

    expect(ticketTokenFor("T1")).toBe("tok");
    expect(claimShipmentFor("C1")).toBe("S1");
    expect(ticketTokenFor("T2")).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain("tok");
  });

  it("copes with blocked storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });

    expect(() => rememberTicketToken("T1", "tok")).not.toThrow();
    expect(ticketTokenFor("T1")).toBeNull();
    expect(claimShipmentFor("C1")).toBeNull();
  });
});

describe("support links on the shipment page", () => {
  it("offers support and claims for a shipment in progress", async () => {
    ship.fetchShipment.mockResolvedValue(shipment({ status: "in_transit", status_label: "In transit", cancellable: false }));
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/support?shipment=LG000000000001&ref=S1");
    expect(screen.getByRole("link", { name: "Make a claim" })).toHaveAttribute("href", "/shipments/S1/claim");
  });

  it("offers support but no claim before collection or after cancellation", async () => {
    ship.fetchShipment.mockResolvedValue(shipment({ status: "booking_confirmed", status_label: "Booking confirmed" }));
    const first = renderWithClient(<ShipmentView id="S1" />);
    await screen.findByRole("link", { name: "Contact support" });
    expect(screen.queryByRole("link", { name: "Make a claim" })).not.toBeInTheDocument();
    first.unmount();

    ship.fetchShipment.mockResolvedValue(shipment({ status: "cancelled", status_label: "Cancelled", cancellable: false, payment: { ...shipment().payment, requires_payment: false, refunded: money(0) } }));
    renderWithClient(<ShipmentView id="S1" />);
    await screen.findByRole("link", { name: "Contact support" });
    expect(screen.queryByRole("link", { name: "Make a claim" })).not.toBeInTheDocument();
  });
});
