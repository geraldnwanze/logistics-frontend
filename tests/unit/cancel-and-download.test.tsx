import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancellationConsequence, CancelPanel } from "@/components/booking/cancel-panel";
import { ShipmentView } from "@/components/booking/shipment-view";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import { downloadInvoice, isApiUrl } from "@/lib/shipping/download";
import { shipmentSchema } from "@/lib/shipping/schemas";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { money, shipment } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/shipping/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shipping/api")>()), fetchShipment: vi.fn(), cancelShipment: vi.fn(), fetchInvoiceLink: vi.fn(), startPayment: vi.fn() }));

const api = vi.mocked(shippingApi);
const paid = () => shipment({ payment: { method: "prepaid", status: "paid", invoice_id: "INV1", invoice_number: "INV-1", requires_payment: false } });

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("cancellationConsequence", () => {
  it("promises exactly what the API will do with the money", () => {
    expect(cancellationConsequence(paid())).toBe("You've paid $70.41. It will be refunded in full to your original payment method.");
    expect(cancellationConsequence(shipment())).toMatch(/haven't paid yet.*nothing will be charged/);
    expect(cancellationConsequence(shipment({ payment: { ...shipment().payment, method: "invoice", status: "issued", requires_payment: false } }))).toBe("Your invoice will be cancelled. Nothing will be charged.");
  });
});

describe("CancelPanel", () => {
  it("is collapsed until asked for, and can be dismissed", async () => {
    renderWithClient(<CancelPanel shipment={paid()} />);

    expect(screen.queryByText("Cancel this booking?")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    expect(screen.getByRole("heading", { name: "Cancel this booking?" })).toBeInTheDocument();
    expect(screen.getByText(/refunded in full/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep my booking" }));
    expect(api.cancelShipment).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel this booking" })).toBeInTheDocument();
  });

  it("cancels with the reason and refreshes what is stored for this shipment", async () => {
    const cancelled = shipment({ status: "cancelled", status_label: "Cancelled", cancellable: false });
    api.cancelShipment.mockResolvedValue(cancelled);
    const { client } = renderWithClient(<CancelPanel shipment={paid()} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    await userEvent.type(screen.getByLabelText("Reason (optional)"), "Changed my mind");
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel booking" }));

    await waitFor(() => expect(api.cancelShipment).toHaveBeenCalledWith(paid().id, "Changed my mind"));
    await waitFor(() => expect(client.getQueryData(["shipment", paid().id])).toEqual(cancelled));
  });

  it("limits the reason to what the API accepts", async () => {
    renderWithClient(<CancelPanel shipment={paid()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));

    expect(screen.getByLabelText("Reason (optional)")).toHaveAttribute("maxlength", "250");
  });

  it("explains a shipment that was collected in the meantime, and offers no retry loop", async () => {
    api.cancelShipment.mockRejectedValue(new ApiError(409, "shipment_collected", "This shipment has already been collected and can no longer be cancelled here."));
    renderWithClient(<CancelPanel shipment={paid()} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel booking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already been collected");
  });

  it("reports other failures and lets the customer try again", async () => {
    api.cancelShipment.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<CancelPanel shipment={paid()} />);

    await userEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel booking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
    expect(screen.getByRole("button", { name: "Yes, cancel booking" })).toBeEnabled();
  });
});

describe("ShipmentView with cancellation and documents", () => {
  it("offers cancellation only while the shipment can still be cancelled", async () => {
    api.fetchShipment.mockResolvedValue(paid());
    const first = renderWithClient(<ShipmentView id="S1" />);
    expect(await screen.findByRole("button", { name: "Cancel this booking" })).toBeInTheDocument();
    first.unmount();

    api.fetchShipment.mockResolvedValue({ ...paid(), cancellable: false, status: "picked_up", status_label: "Picked up" });
    renderWithClient(<ShipmentView id="S1" />);
    await screen.findByText("LG000000000001");
    expect(screen.queryByRole("button", { name: "Cancel this booking" })).not.toBeInTheDocument();
  });

  it("shows a cancelled booking with the reason and the refund", async () => {
    api.fetchShipment.mockResolvedValue(shipment({ status: "cancelled", status_label: "Cancelled", cancellable: false, cancellation_reason: "Changed my mind", cancelled_at: "2026-10-17T08:00:00Z", payment: { method: "prepaid", status: "paid", invoice_id: "INV1", invoice_number: "INV-1", requires_payment: false, refunded: money(7041) } }));
    renderWithClient(<ShipmentView id="S1" />);

    const banner = await screen.findByText(/This booking was cancelled/);
    expect(banner.closest("div")).toHaveTextContent("Reason: Changed my mind");
    expect(banner.closest("div")).toHaveTextContent(/Refunded: .*70\.41/);
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel this booking" })).not.toBeInTheDocument();
  });

  it("says nothing was charged for a booking cancelled before payment", async () => {
    api.fetchShipment.mockResolvedValue(shipment({ status: "cancelled", status_label: "Cancelled", cancellable: false, payment: { ...shipment().payment, requires_payment: false, status: "void" } }));
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByText("You were not charged.")).toBeInTheDocument();
  });

  it("downloads the invoice before payment and the receipt after, using the shipment for a guest's access", async () => {
    api.fetchShipment.mockResolvedValue(shipment());
    api.fetchInvoiceLink.mockResolvedValue({ url: "http://localhost:8000/api/v1/documents/D1/download?signature=x", type: "invoice" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, origin: window.location.origin });
    const view = renderWithClient(<ShipmentView id="S1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Download invoice (PDF)" }));

    await waitFor(() => expect(api.fetchInvoiceLink).toHaveBeenCalledWith("INV", "S1"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://localhost:8000/api/v1/documents/D1/download?signature=x"));
    view.unmount();
    vi.unstubAllGlobals();

    api.fetchShipment.mockResolvedValue(paid());
    renderWithClient(<ShipmentView id="S1" />);
    expect(await screen.findByRole("button", { name: "Download receipt (PDF)" })).toBeInTheDocument();
  });
});

describe("downloadInvoice", () => {
  it("only follows links that point at our own API", async () => {
    const navigate = vi.fn();
    api.fetchInvoiceLink.mockResolvedValue({ url: "https://evil.example/invoice.pdf", type: "invoice" });

    expect(await downloadInvoice("INV1", undefined, navigate)).toMatch(/couldn't prepare the download/);
    expect(navigate).not.toHaveBeenCalled();

    api.fetchInvoiceLink.mockResolvedValue({ url: "http://localhost:8000/api/v1/documents/D1/download?signature=x", type: "invoice" });
    expect(await downloadInvoice("INV1", undefined, navigate)).toBeNull();
    expect(navigate).toHaveBeenCalledWith("http://localhost:8000/api/v1/documents/D1/download?signature=x");
  });

  it.each([["http://localhost:8000/x", true], ["http://localhost:8000.evil.example/x", false], ["https://localhost:8000/x", false], ["javascript:alert(1)", false], ["not a url", false], ["//localhost:8000/x", false]])("treats %s as API link: %s", (url, expected) => {
    expect(isApiUrl(url)).toBe(expected);
  });

  it("gives plain messages for a missing invoice and an unreachable server", async () => {
    api.fetchInvoiceLink.mockRejectedValueOnce(new ApiError(404, "not_found", "x"));
    expect(await downloadInvoice("gone")).toBe("We couldn't find this invoice.");

    api.fetchInvoiceLink.mockRejectedValueOnce(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    expect(await downloadInvoice("INV1")).toMatch(/couldn't reach the server/);
  });
});

describe("shipment schema", () => {
  it("treats an older response without cancellation fields as not cancellable", () => {
    const { cancellable, ...older } = shipment();   // eslint-disable-line @typescript-eslint/no-unused-vars
    const parsed = shipmentSchema.parse(older);

    expect(parsed.cancellable).toBe(false);
    expect(parsed.cancellation_reason).toBeUndefined();
  });
});
