import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShipmentScreen, ComplianceScreen } from "@/components/admin/screens";
import * as customsApi from "@/lib/admin/customs";
import type { ComplianceRow, CustomsOverview } from "@/lib/admin/customs";
import * as shipmentsApi from "@/lib/admin/shipments";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { OPS, shipmentDetail, shipmentRow, staff } from "./admin-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/compliance" }));
vi.mock("@/lib/admin/shipments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/shipments")>();

  return { ...real, fetchAdminShipment: vi.fn(), fetchShipmentAssignees: vi.fn() };
});
vi.mock("@/lib/admin/customs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/customs")>();

  return { ...real, fetchComplianceQueue: vi.fn(), reviewCompliance: vi.fn(), fetchCustomsOverview: vi.fn(), recordCustomsCharge: vi.fn(), payCustomsCharge: vi.fn(), waiveCustomsCharge: vi.fn() };
});
vi.mock("@/lib/auth/api");

const api = vi.mocked(customsApi);
const ship = vi.mocked(shipmentsApi);
const auth = vi.mocked(authApi);
const OFFICER = [...OPS, "customs.manage"];

const finding = (over = {}) => ({ index: 0, action: "restricted", label: "Batteries", reason: "Lithium cells need special packing", matched: "battery", ...over });
const held = (over = {}) => shipmentDetail({
  compliance_status: "review_required",
  items: [{ description: "Spare battery", quantity: 1, unit_value_minor: 2000, currency_code: "USD", hs_code: null, origin_country: "NG" }],
  compliance: { status: "review_required", note: null, reviewed_at: null, findings: [finding()] }, ...over,
});

const overview = (over: Partial<CustomsOverview> = {}): CustomsOverview => ({
  international: true,
  declaration: { incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: "DE123", eori_number: "NG-EORI-1", remarks: null },
  requirements: [
    { id: 1, direction: "export", document_type: "export_licence", label: "Export licence", mandatory: true, notes: null, status: "missing", reason: "No export licence on file." },
    { id: 2, direction: "import", document_type: "commercial_invoice", label: "Commercial invoice", mandatory: true, notes: null, status: "satisfied", reason: null },
    { id: 3, direction: "import", document_type: "packing_list", label: "Packing list", mandatory: false, notes: null, status: "missing", reason: "No packing list on file." },
  ],
  ready_for_export: false,
  estimates: { note: "Estimates.", items: [{ label: "Import duty (estimate)", amount_minor: 400, currency: "USD" }] },
  assessed_charges: { note: "Assessed.", items: [{ id: "CH1", type: "duty", description: "Import duty", amount_minor: 1250, currency: "USD", assessed_by: "German customs", authority_reference: "DE-77", status: "assessed", paid_at: null }] },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  auth.fetchCurrentUser.mockResolvedValue(staff(OFFICER));
  ship.fetchShipmentAssignees.mockResolvedValue([]);
  api.fetchCustomsOverview.mockResolvedValue(overview());
});

describe("compliance queue", () => {
  const queueRow = (over: Partial<ComplianceRow> = {}): ComplianceRow => ({ ...shipmentRow({ compliance_status: "review_required" }), findings: [finding()], ...over });
  const page = (items: ComplianceRow[]) => ({ items, page: 1, lastPage: 1, total: items.length });

  it("lists held shipments with what matched, oldest first as the API sends them", async () => {
    api.fetchComplianceQueue.mockResolvedValue(page([queueRow(), queueRow({ id: "S2", tracking_number: "LG000000000002", findings: [finding({ label: "Knives", action: "prohibited", reason: null })] })]));
    renderWithClient(<ComplianceScreen />);

    const first = (await screen.findByRole("link", { name: "LG000000000001" })).closest("li")!;
    expect(first).toHaveTextContent("Lagos, NG → Berlin, DE");
    expect(first).toHaveTextContent("Batteries");
    expect(first).toHaveTextContent("Lithium cells need special packing");
    expect(first).toHaveTextContent("Restricted");
    const second = screen.getByRole("link", { name: "LG000000000002" }).closest("li")!;
    expect(second).toHaveTextContent("Prohibited");
    expect(screen.getByText("2 shipments waiting")).toBeInTheDocument();
  });

  it("says when nothing is waiting, and when it can't load", async () => {
    api.fetchComplianceQueue.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([]));
    renderWithClient(<ComplianceScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("is closed to people who don't manage customs", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(OPS));
    renderWithClient(<ComplianceScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchComplianceQueue).not.toHaveBeenCalled();
  });
});

describe("the compliance panel", () => {
  const open = (perms = OFFICER, detail = held()) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(perms));
    ship.fetchAdminShipment.mockResolvedValue(detail);

    return renderWithClient(<ShipmentScreen id="S1" />);
  };

  it("is absent when nothing is held", async () => {
    open(OFFICER, shipmentDetail());
    await screen.findByRole("heading", { name: "LG000000000001" });

    expect(screen.queryByRole("region", { name: /Compliance/ })).not.toBeInTheDocument();
  });

  it("shows why it is held, naming the item, to everyone who can open the shipment", async () => {
    open(OPS);   // can view the shipment, cannot decide

    const panel = await screen.findByRole("region", { name: /Compliance/ });
    const matched = within(panel).getByRole("list", { name: "What matched" });
    expect(matched).toHaveTextContent("Batteries");
    expect(matched).toHaveTextContent("Item 1: Spare battery · matched “battery”");
    expect(matched).toHaveTextContent("Lithium cells need special packing");
    expect(screen.getByText("On compliance hold")).toBeInTheDocument();
    expect(within(panel).queryByRole("form", { name: "Decide" })).not.toBeInTheDocument();
    expect(within(panel).getByText("A compliance officer will review this.")).toBeInTheDocument();
  });

  it("needs a reason, asks first, and approves", async () => {
    api.reviewCompliance.mockResolvedValue({ status: "booking_confirmed", compliance_status: "approved" });
    open();
    const decide = await screen.findByRole("form", { name: "Decide" });
    expect(within(decide).getByRole("button", { name: "Review decision" })).toBeDisabled();

    await userEvent.type(within(decide).getByLabelText(/Reason/), "Packed to regulations");
    await userEvent.click(within(decide).getByRole("button", { name: "Review decision" }));
    expect(screen.getByRole("group", { name: "Confirm decision" })).toHaveTextContent("Release the hold");
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(api.reviewCompliance).not.toHaveBeenCalled();

    await userEvent.click(within(decide).getByRole("button", { name: "Review decision" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    await waitFor(() => expect(api.reviewCompliance).toHaveBeenCalledWith("S1", "approve", "Packed to regulations"));
  });

  it("says rejecting cancels the booking and refunds the customer", async () => {
    api.reviewCompliance.mockResolvedValue({ status: "cancelled", compliance_status: "rejected" });
    open();
    const decide = await screen.findByRole("form", { name: "Decide" });

    await userEvent.click(within(decide).getByLabelText("Reject"));
    await userEvent.type(within(decide).getByLabelText(/Reason/), "Cannot be carried by air");
    await userEvent.click(within(decide).getByRole("button", { name: "Review decision" }));
    expect(screen.getByRole("group", { name: "Confirm decision" })).toHaveTextContent("The booking is cancelled and $70.41 is refunded to the customer");
    await userEvent.click(screen.getByRole("button", { name: "Yes, reject and cancel" }));

    await waitFor(() => expect(api.reviewCompliance).toHaveBeenCalledWith("S1", "reject", "Cannot be carried by air"));
  });

  it("explains it when someone decided first, and reloads", async () => {
    api.reviewCompliance.mockRejectedValue(new ApiError(409, "no_review_pending", "x"));
    open();
    const decide = await screen.findByRole("form", { name: "Decide" });
    await userEvent.type(within(decide).getByLabelText(/Reason/), "ok");
    await userEvent.click(within(decide).getByRole("button", { name: "Review decision" }));
    ship.fetchAdminShipment.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else has already decided this");
    await waitFor(() => expect(ship.fetchAdminShipment).toHaveBeenCalled());
  });

  it("shows the outcome once decided, with the reason", async () => {
    open(OFFICER, held({ compliance_status: "approved", compliance: { status: "approved", note: "Packed to regulations", reviewed_at: "2026-10-16T09:00:00Z", findings: [finding()] } }));

    const panel = await screen.findByRole("region", { name: /Compliance/ });
    expect(panel).toHaveTextContent("Approved");
    expect(panel).toHaveTextContent("Packed to regulations");
    expect(within(panel).queryByRole("form", { name: "Decide" })).not.toBeInTheDocument();
  });
});

describe("the customs panel", () => {
  const open = (perms = OFFICER, detail = shipmentDetail()) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(perms));
    ship.fetchAdminShipment.mockResolvedValue(detail);

    return renderWithClient(<ShipmentScreen id="S1" />);
  };

  it("is only for people who manage customs, and only on cross-border shipments", async () => {
    const view = open(OPS);
    await screen.findByRole("heading", { name: "LG000000000001" });
    expect(screen.queryByRole("region", { name: "Customs" })).not.toBeInTheDocument();
    expect(api.fetchCustomsOverview).not.toHaveBeenCalled();
    view.unmount();

    api.fetchCustomsOverview.mockResolvedValue(overview({ international: false }));
    const base = shipmentDetail();
    open(OFFICER, { ...base, tracking: { ...base.tracking, international: false } });
    await screen.findByRole("heading", { name: "LG000000000001" });
    expect(screen.queryByRole("region", { name: "Customs" })).not.toBeInTheDocument();
  });

  it("shows the declaration, the document checklist and whether departure is held", async () => {
    open();

    const panel = await screen.findByRole("region", { name: "Customs" });
    expect(panel).toHaveTextContent("Declaration: DAP, exporting for sale · EORI NG-EORI-1 · consignee tax ID DE123");
    const docs = within(panel).getByRole("list", { name: "Required documents" });
    expect(docs).toHaveTextContent("Missing");
    expect(docs).toHaveTextContent("Export licence (leaving the country)");
    expect(docs).toHaveTextContent("No export licence on file.");
    expect(docs).toHaveTextContent("Packing list (arriving) · optional");
    expect(within(panel).getByText("Departure is held until the mandatory export documents are on file.")).toBeInTheDocument();
  });

  it("says when there's no declaration and when everything is on file", async () => {
    api.fetchCustomsOverview.mockResolvedValue(overview({ declaration: null, requirements: [], ready_for_export: true }));
    open();

    expect(await screen.findByText("The customer hasn't made a customs declaration yet.")).toBeInTheDocument();
    expect(screen.getByText("No documents are required for this route.")).toBeInTheDocument();
    expect(screen.getByText("Every document needed before this shipment leaves the country is on file.")).toBeInTheDocument();
  });

  it("keeps estimates apart from the charges customs actually assessed", async () => {
    open();

    const panel = await screen.findByRole("region", { name: "Customs" });
    expect(panel).toHaveTextContent("Estimated at booking: Import duty (estimate) $4.00.");
    const charges = within(panel).getByRole("list", { name: "Assessed charges" });
    expect(charges).toHaveTextContent("Duty: $12.50");
    expect(charges).toHaveTextContent("German customs");
    expect(charges).toHaveTextContent("To be paid");
  });

  it("records that a charge was paid, naming who paid and the reference", async () => {
    api.payCustomsCharge.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Record payment of Import duty/ }));
    const form = screen.getByRole("form", { name: "Record payment of Import duty" });

    expect(within(form).getByRole("button", { name: "Save payment" })).toBeDisabled();
    await userEvent.selectOptions(within(form).getByLabelText("Paid by"), "The sender");
    await userEvent.type(within(form).getByLabelText("Payment reference"), "DE-PAY-1");
    await userEvent.click(within(form).getByRole("button", { name: "Save payment" }));

    await waitFor(() => expect(api.payCustomsCharge).toHaveBeenCalledWith("CH1", "sender", "DE-PAY-1"));
  });

  it("waives a charge only after confirming", async () => {
    api.waiveCustomsCharge.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Waive Import duty/ }));
    expect(screen.getByRole("group", { name: "Confirm waiving Import duty" })).toHaveTextContent("Waive $12.50?");
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.waiveCustomsCharge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Waive Import duty/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, waive it" }));
    await waitFor(() => expect(api.waiveCustomsCharge).toHaveBeenCalledWith("CH1"));
  });

  it("explains it when a charge was settled by someone else, and reloads", async () => {
    api.payCustomsCharge.mockRejectedValue(new ApiError(409, "charge_not_payable", "x"));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Record payment of Import duty/ }));
    const form = screen.getByRole("form", { name: "Record payment of Import duty" });
    await userEvent.type(within(form).getByLabelText("Payment reference"), "X");
    api.fetchCustomsOverview.mockClear();
    await userEvent.click(within(form).getByRole("button", { name: "Save payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already been settled");
    await waitFor(() => expect(api.fetchCustomsOverview).toHaveBeenCalled());
  });

  describe("recording a charge", () => {
    it("checks the form, asks first, and sends the amount as typed", async () => {
      api.recordCustomsCharge.mockResolvedValue(undefined);
      open();
      const form = await screen.findByRole("form", { name: "Record a charge" });
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      expect(within(form).getByText("Say what the charge is for.")).toBeInTheDocument();
      expect(within(form).getByText("Enter the amount customs assessed.")).toBeInTheDocument();
      expect(within(form).getByText("Say which authority assessed it.")).toBeInTheDocument();

      await userEvent.type(within(form).getByLabelText("What it is for"), "Import VAT");
      await userEvent.selectOptions(within(form).getByLabelText("Type"), "Tax");
      await userEvent.type(within(form).getByLabelText("Amount"), "19.995");
      await userEvent.type(within(form).getByLabelText("Assessed by"), "German customs");
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      expect(within(form).getByText("Enter an amount with at most 2 decimal places.")).toBeInTheDocument();

      await userEvent.clear(within(form).getByLabelText("Amount"));
      await userEvent.type(within(form).getByLabelText("Amount"), "19.99");
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      expect(within(form).getByRole("group", { name: "Confirm charge" })).toHaveTextContent("Add a $19.99 tax charge? The customer can see it");
      await userEvent.click(within(form).getByRole("button", { name: "Yes, add the charge" }));

      await waitFor(() => expect(api.recordCustomsCharge).toHaveBeenCalledWith("S1", { type: "tax", description: "Import VAT", amount: "19.99", currency: "USD", assessed_by: "German customs" }));
    });

    it("uses the currency's own decimals and refuses a bad code", async () => {
      open();
      const form = await screen.findByRole("form", { name: "Record a charge" });
      await userEvent.type(within(form).getByLabelText("What it is for"), "Duty");
      await userEvent.type(within(form).getByLabelText("Assessed by"), "Customs");
      await userEvent.clear(within(form).getByLabelText("Currency"));
      await userEvent.type(within(form).getByLabelText("Currency"), "JP");
      await userEvent.type(within(form).getByLabelText("Amount"), "100");
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      expect(within(form).getByText("Use the three-letter currency code, for example USD.")).toBeInTheDocument();

      await userEvent.type(within(form).getByLabelText("Currency"), "Y");
      await userEvent.clear(within(form).getByLabelText("Amount"));
      await userEvent.type(within(form).getByLabelText("Amount"), "100.5");
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      expect(within(form).getByText("Enter an amount with at most 0 decimal places.")).toBeInTheDocument();
    });

    it("shows the API's refusal", async () => {
      api.recordCustomsCharge.mockRejectedValue(new ApiError(422, "not_international", "Customs charges only apply to cross-border shipments."));
      open();
      const form = await screen.findByRole("form", { name: "Record a charge" });
      await userEvent.type(within(form).getByLabelText("What it is for"), "Duty");
      await userEvent.type(within(form).getByLabelText("Amount"), "5");
      await userEvent.type(within(form).getByLabelText("Assessed by"), "Customs");
      await userEvent.click(within(form).getByRole("button", { name: "Review charge" }));
      await userEvent.click(within(form).getByRole("button", { name: "Yes, add the charge" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Customs charges only apply to cross-border shipments.");
    });
  });
});
