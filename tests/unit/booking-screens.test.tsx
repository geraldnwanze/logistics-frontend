import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow, BookingForm } from "@/components/booking/booking-flow";
import { SandboxPay } from "@/components/booking/sandbox-pay";
import { ShipmentView } from "@/components/booking/shipment-view";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import * as shippingApi from "@/lib/shipping/api";
import { guestTokenFor } from "@/lib/shipping/guest";
import { ada, push, renderWithClient, replace, searchParams } from "./auth-support";
import { COUNTRIES, option, quote, shipment } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/auth/api");

const api = vi.mocked(shippingApi);
const SANDBOX_URL = `${window.location.origin}/sandbox-pay?reference=sbx_abc123`;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

async function fillRequired() {
  await userEvent.type(screen.getByLabelText("Your email"), "ife@example.test");
  const [sender, recipient] = screen.getAllByRole("group").filter((g) => g.tagName === "FIELDSET");
  const s = within(sender);
  const r = within(recipient);
  await userEvent.type(s.getByLabelText("Full name"), "Ife Okoro");
  await userEvent.type(s.getByLabelText("Phone"), "+2348012345678");
  await userEvent.type(s.getByLabelText("Address"), "1 Marina Road");
  await userEvent.type(s.getByLabelText("State"), "Lagos");
  await userEvent.type(r.getByLabelText("Full name"), "Hans Becker");
  await userEvent.type(r.getByLabelText("Phone"), "+4915112345678");
  await userEvent.type(r.getByLabelText("Address"), "2 Unter den Linden");
  await userEvent.click(screen.getByLabelText(/I accept the terms/));
}

const renderForm = (over = {}) => renderWithClient(<BookingForm quote={quote(over)} option={option()} countries={COUNTRIES} />);
const submit = () => userEvent.click(screen.getByRole("button", { name: /^Book and pay/ }));

describe("BookingForm", () => {
  it("shows what is being bought and what is not included", () => {
    renderForm();

    expect(screen.getByRole("region", { name: "Your choice" })).toHaveTextContent("International Economy");
    expect(screen.getByRole("region", { name: "Your choice" })).toHaveTextContent("70.41");
    expect(screen.getByRole("region", { name: "Payment" })).toHaveTextContent(/estimates, are not in this total/);
    expect(screen.getByRole("button", { name: /Book and pay .*70\.41/ })).toBeInTheDocument();
  });

  it("starts the items from what was quoted, so they add up to the declared value", () => {
    renderForm();

    expect(screen.getByLabelText("Description")).toHaveValue("Clothing");
    expect(screen.getByLabelText(/Value each \(USD\)/)).toHaveValue("100.00");
    expect(screen.getByText(/Items total:/)).toHaveTextContent("100.00");
    expect(screen.getByText(/must add up to .*100\.00.*you declared/)).toBeInTheDocument();
  });

  it("fixes the countries to the quote's and applies their rules", () => {
    renderForm();
    const [sender, recipient] = screen.getAllByRole("group").filter((g) => g.tagName === "FIELDSET");

    expect(within(sender).getByLabelText("Country")).toBeDisabled();
    expect(within(sender).getByLabelText("Country")).toHaveValue("NG");
    expect(within(sender).getByLabelText("State")).toBeRequired();
    expect(within(recipient).getByLabelText("Postal code")).toHaveValue("10115");
    expect(within(recipient).getByLabelText("Postal code")).toBeRequired();
    expect(within(recipient).getByLabelText(/State \(optional\)/)).toBeInTheDocument();
  });

  it("books as a guest, remembers the access token for this tab only, and goes to pay", async () => {
    api.bookShipment.mockResolvedValue({ ...shipment(), guest_access_token: "guest-secret-token" });
    api.startPayment.mockResolvedValue({ id: "P1", status: "requires_action", action: { type: "redirect", url: SANDBOX_URL, sandbox: true } });
    renderForm();
    await fillRequired();

    await submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/sandbox-pay?reference=sbx_abc123&shipment=${shipment().id}`));
    const [input, key] = api.bookShipment.mock.calls[0];
    expect(input).toMatchObject({ quote_id: "QUOTE1", option_id: "OPT1", contact_email: "ife@example.test", terms_accepted: true, items: [{ description: "Clothing", quantity: 1, unit_value: "100.00", origin_country: "NG" }] });
    expect(input.sender).toMatchObject({ name: "Ife Okoro", state: "Lagos", postal_code: "100001", country: "NG" });
    expect(key).toMatch(/\S{8,}/);
    expect(guestTokenFor(shipment().id)).toBe("guest-secret-token");
    expect(JSON.stringify(push.mock.calls)).not.toContain("guest-secret-token");
    expect(api.startPayment).toHaveBeenCalledWith(shipment().id, expect.any(String));
  });

  it("does not book when something is wrong, and says what", async () => {
    renderForm();

    await submit();

    expect(api.bookShipment).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Your email")).toBeInvalid();
    expect(screen.getByLabelText(/I accept the terms/)).toBeInvalid();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("check the highlighted fields");
  });

  it("catches items that don't add up to the declared value, with both amounts", async () => {
    renderForm();
    await fillRequired();
    await userEvent.clear(screen.getByLabelText(/Value each/));
    await userEvent.type(screen.getByLabelText(/Value each/), "99.99");

    await submit();

    expect(screen.getByText(/add up to .*99\.99.*declared .*100\.00/)).toBeInTheDocument();
    expect(api.bookShipment).not.toHaveBeenCalled();
  });

  it("keeps a running total as items are added", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add another item" }));
    const values = screen.getAllByLabelText(/Value each/);
    await userEvent.type(values[1], "25.50");
    await userEvent.clear(screen.getAllByLabelText("Quantity")[1]);
    await userEvent.type(screen.getAllByLabelText("Quantity")[1], "2");

    expect(screen.getByText(/Items total:/)).toHaveTextContent("151.00");
  });

  it("does not ask for a contact email once signed in", async () => {
    localStorage.setItem("signed-in-hint", "1");
    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(ada);
    renderForm();

    await waitFor(() => expect(screen.queryByLabelText("Your email")).not.toBeInTheDocument());
  });

  it("reuses the same idempotency key when the identical booking is retried, and a new one when it changed", async () => {
    api.bookShipment.mockRejectedValueOnce(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.")).mockRejectedValueOnce(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.")).mockResolvedValue({ ...shipment(), payment: { ...shipment().payment, requires_payment: false } });
    renderForm();
    await fillRequired();

    await submit();
    await screen.findByText(/couldn't reach the server/);
    await submit();
    await screen.findByText(/couldn't reach the server/);
    expect(api.bookShipment.mock.calls[1][1]).toBe(api.bookShipment.mock.calls[0][1]);

    await userEvent.type(screen.getByLabelText(/Delivery instructions/), "Leave at reception");
    await submit();

    expect(api.bookShipment.mock.calls[2][1]).not.toBe(api.bookShipment.mock.calls[0][1]);
  });

  it("goes straight to the shipment when nothing needs paying now", async () => {
    api.bookShipment.mockResolvedValue({ ...shipment(), payment: { ...shipment().payment, requires_payment: false } });
    renderForm();
    await fillRequired();

    await submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/shipments/${shipment().id}`));
    expect(api.startPayment).not.toHaveBeenCalled();
  });

  it("keeps the booking and offers a retry when payment cannot be started", async () => {
    api.bookShipment.mockResolvedValue(shipment());
    api.startPayment.mockRejectedValue(new ApiError(500, "server_error", "x"));
    renderForm();
    await fillRequired();

    await submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/shipments/${shipment().id}?payment=error`));
  });

  it("never follows an unsafe payment address", async () => {
    api.bookShipment.mockResolvedValue(shipment());
    api.startPayment.mockResolvedValue({ id: "P1", status: "x", action: { type: "redirect", url: "javascript:alert(1)" } });
    renderForm();
    await fillRequired();

    await submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/shipments/${shipment().id}?payment=error`));
  });

  it("shows the API's field errors where they belong and keeps what was typed", async () => {
    api.bookShipment.mockRejectedValue(new ApiError(422, "validation_failed", "x", { "sender.phone": ["The sender.phone field format is invalid."], items: ["The total value of the items must equal the declared value used for the quote."] }));
    renderForm();
    await fillRequired();

    await submit();

    expect(await screen.findByText("The sender.phone field format is invalid.")).toBeInTheDocument();
    expect(screen.getByText(/must equal the declared value/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your email")).toHaveValue("ife@example.test");
    expect(push).not.toHaveBeenCalled();
  });

  it("tells the customer when the prices expired while they were filling in the form", async () => {
    api.bookShipment.mockRejectedValue(new ApiError(409, "quote_expired", "This quote has expired."));
    renderForm();
    await fillRequired();

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("just expired");
  });

  it("reveals the collection fields only when collection is wanted, and validates them", async () => {
    renderForm();
    expect(screen.queryByLabelText("Between")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Collect the shipment/));
    expect(screen.getByLabelText("Between")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("and"));
    await userEvent.type(screen.getByLabelText("and"), "08:00");
    await fillRequired();
    await submit();

    expect(screen.getByLabelText("and")).toHaveAccessibleDescription("The end must be after the start.");
  });
});

describe("BookingFlow", () => {
  it("refuses an option that isn't in the quote", async () => {
    searchParams.set("option", "NOPE");
    api.fetchQuote.mockResolvedValue(quote());
    api.fetchCountries.mockResolvedValue(COUNTRIES);
    renderWithClient(<BookingFlow quoteId="QUOTE1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find the option you chose");
    expect(screen.getByRole("link", { name: "Back to the prices" })).toHaveAttribute("href", "/quote/QUOTE1");
  });

  it("will not book expired prices", async () => {
    searchParams.set("option", "OPT1");
    api.fetchQuote.mockResolvedValue(quote({ status: "expired" }));
    api.fetchCountries.mockResolvedValue(COUNTRIES);
    renderWithClient(<BookingFlow quoteId="QUOTE1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("prices have expired");
    expect(screen.getByRole("link", { name: "Get new prices" })).toHaveAttribute("href", "/quote");
  });

  it("shows the form for a good quote and option", async () => {
    searchParams.set("option", "OPT1");
    api.fetchQuote.mockResolvedValue(quote());
    api.fetchCountries.mockResolvedValue(COUNTRIES);
    renderWithClient(<BookingFlow quoteId="QUOTE1" />);

    expect(await screen.findByRole("button", { name: /Book and pay/ })).toBeInTheDocument();
  });

  it("says when the quote doesn't exist", async () => {
    api.fetchQuote.mockRejectedValue(new ApiError(404, "not_found", "x"));
    api.fetchCountries.mockResolvedValue(COUNTRIES);
    renderWithClient(<BookingFlow quoteId="gone" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this quote");
  });
});

describe("ShipmentView", () => {
  it("shows the tracking number, status and what is owed, with a way to pay", async () => {
    api.fetchShipment.mockResolvedValue(shipment());
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByText("LG000000000001")).toBeInTheDocument();
    expect(screen.getByText(/Status:/)).toHaveTextContent("Booking pending");
    expect(screen.getByText("Payment needed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Track this shipment" })).toHaveAttribute("href", "/track/LG000000000001");
    expect(screen.getByText(/Demonstration shipment/)).toBeInTheDocument();
    expect(screen.getByText("2 × Cotton shirts")).toBeInTheDocument();
  });

  it("starts payment from the page and goes to the checkout", async () => {
    api.fetchShipment.mockResolvedValue(shipment());
    api.startPayment.mockResolvedValue({ id: "P1", status: "x", action: { type: "redirect", url: SANDBOX_URL } });
    renderWithClient(<ShipmentView id="S1" />);

    await userEvent.click(await screen.findByRole("button", { name: /^Pay / }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sandbox-pay?reference=sbx_abc123&shipment=S1"));
  });

  it("reports a payment that could not start", async () => {
    api.fetchShipment.mockResolvedValue(shipment());
    api.startPayment.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<ShipmentView id="S1" />);

    await userEvent.click(await screen.findByRole("button", { name: /^Pay / }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
  });

  it("shows a paid shipment with no pay button", async () => {
    api.fetchShipment.mockResolvedValue(shipment({ status_label: "Booking confirmed", payment: { method: "prepaid", status: "paid", invoice_id: "I", invoice_number: "INV-1", requires_payment: false } }));
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByText("Paid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay / })).not.toBeInTheDocument();
  });

  it("explains a booking whose payment could not be started", async () => {
    searchParams.set("payment", "error");
    api.fetchShipment.mockResolvedValue(shipment());
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByText(/Your booking is saved, but we couldn't start the payment/)).toBeInTheDocument();
  });

  it("says it can't find a shipment (the guest's tab may have closed) and points to public tracking", async () => {
    api.fetchShipment.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("same browser tab you booked in");
    expect(screen.getByRole("link", { name: "Track a shipment" })).toHaveAttribute("href", "/track");
  });

  describe("coming back from the payment page", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("keeps checking until the provider's confirmation arrives, then says the shipment is confirmed", async () => {
      searchParams.set("returned", "1");
      api.fetchShipment.mockResolvedValueOnce(shipment()).mockResolvedValue(shipment({ status_label: "Booking confirmed", payment: { method: "prepaid", status: "paid", invoice_id: "I", invoice_number: "INV-1", requires_payment: false } }));
      renderWithClient(<ShipmentView id="S1" />);

      expect(await screen.findByText("Waiting for your payment to be confirmed…")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

      expect(await screen.findByText("Payment received. Your shipment is confirmed.")).toBeInTheDocument();
      expect(screen.queryByText(/Waiting for your payment/)).not.toBeInTheDocument();
    });

    it("stops waiting after a minute and says confirmation is still pending", async () => {
      searchParams.set("returned", "1");
      api.fetchShipment.mockResolvedValue(shipment());
      renderWithClient(<ShipmentView id="S1" />);
      await screen.findByText("Waiting for your payment to be confirmed…");

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });

      expect(await screen.findByText(/haven't received confirmation of your payment yet/)).toBeInTheDocument();
      expect(screen.queryByText("Waiting for your payment to be confirmed…")).not.toBeInTheDocument();
    });
  });
});

describe("SandboxPay", () => {
  it("is plainly labelled as practice, and refuses an incomplete link", () => {
    renderWithClient(<SandboxPay />);

    expect(screen.getByRole("alert")).toHaveTextContent("incomplete");
  });

  it("simulates a successful payment, then returns to the shipment", async () => {
    searchParams.set("reference", "sbx_abc123");
    searchParams.set("shipment", "01SHIP000001AAAAAA");
    api.simulateSandboxPayment.mockResolvedValue();
    renderWithClient(<SandboxPay />);

    expect(screen.getByRole("note")).toHaveTextContent("No card is charged");
    await userEvent.click(screen.getByRole("button", { name: "Pay (simulate success)" }));

    expect(api.simulateSandboxPayment).toHaveBeenCalledWith("sbx_abc123", "succeeded");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/shipments/01SHIP000001AAAAAA?returned=1"));
  });

  it("simulates a declined payment", async () => {
    searchParams.set("reference", "sbx_abc123");
    searchParams.set("shipment", "01SHIP000001AAAAAA");
    api.simulateSandboxPayment.mockResolvedValue();
    renderWithClient(<SandboxPay />);

    await userEvent.click(screen.getByRole("button", { name: "Decline (simulate failure)" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/shipments/01SHIP000001AAAAAA?returned=1&payment=error"));
  });

  it("says so where sandbox payments don't exist", async () => {
    searchParams.set("reference", "sbx_abc123");
    searchParams.set("shipment", "01SHIP000001AAAAAA");
    api.simulateSandboxPayment.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<SandboxPay />);

    await userEvent.click(screen.getByRole("button", { name: "Pay (simulate success)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sandbox payments aren't available");
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores references or shipment ids with odd characters", () => {
    searchParams.set("reference", "<script>");
    searchParams.set("shipment", "../../x");
    renderWithClient(<SandboxPay />);

    expect(screen.getByRole("alert")).toHaveTextContent("incomplete");
  });
});

