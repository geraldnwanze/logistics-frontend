import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteForm } from "@/components/quote/quote-form";
import { QuoteResults, QuoteView } from "@/components/quote/quote-results";
import * as accountApi from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import { push, renderWithClient, replace } from "./auth-support";
import { COUNTRIES, money, option, quote } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/account/api");

const api = vi.mocked(shippingApi);

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchCountries.mockResolvedValue(COUNTRIES);
  vi.mocked(accountApi.fetchProfileOptions).mockResolvedValue({ languages: ["en"], currencies: [{ code: "USD", name: "US Dollar", symbol: "$" }, { code: "EUR", name: "Euro", symbol: "€" }] });
});

/** The country lists fill in once they load; wait for that before touching the form. */
async function countriesLoaded() {
  await screen.findAllByRole("option", { name: "Germany" });

  return screen.getAllByLabelText("Country");
}

async function fillValidForm() {
  const [fromCountry, toCountry] = await countriesLoaded();
  await userEvent.selectOptions(fromCountry, "NG");
  await userEvent.selectOptions(toCountry, "DE");
  const [fromCity, toCity] = screen.getAllByLabelText("City");
  await userEvent.type(fromCity, "Lagos");
  await userEvent.type(toCity, "Berlin");
  await userEvent.type(screen.getAllByLabelText(/Postal code/)[1], "10115");
  await userEvent.type(screen.getByLabelText(/Contents/), "Clothing samples");
  await userEvent.type(screen.getByLabelText("Weight (kg)"), "2");
  await userEvent.type(screen.getByLabelText("Length (cm)"), "30");
  await userEvent.type(screen.getByLabelText("Width (cm)"), "20");
  await userEvent.type(screen.getByLabelText("Height (cm)"), "10");
}

describe("QuoteForm", () => {
  it("sends the request and opens the prices", async () => {
    api.createQuote.mockResolvedValue(quote({ id: "01QUOTE ABC" }));
    renderWithClient(<QuoteForm />);

    await fillValidForm();
    await userEvent.type(screen.getByLabelText(/Declared value/), "100");
    await userEvent.click(screen.getByLabelText(/Add insurance/));
    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(api.createQuote).toHaveBeenCalledWith({
      origin: { country: "NG", city: "Lagos" }, destination: { country: "DE", city: "Berlin", postal_code: "10115" }, shipment_type: "parcel", contents: "Clothing samples", unit_system: "metric",
      packages: [{ type: "box", weight_kg: "2", length_cm: "30", width_cm: "20", height_cm: "10" }], declared_value: { amount: "100", currency: "USD" }, insurance: true,
    });
    expect(push).toHaveBeenCalledWith("/quote/01QUOTE%20ABC");
  });

  it("points at every missing field instead of sending", async () => {
    renderWithClient(<QuoteForm />);
    await countriesLoaded();

    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(api.createQuote).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("City")[0]).toBeInvalid();
    expect(screen.getByLabelText("Weight (kg)")).toHaveAccessibleDescription("Required.");
    expect(screen.getByLabelText(/Contents/)).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent("check the highlighted fields");
  });

  it("applies a country's postal code rules as soon as it is chosen", async () => {
    renderWithClient(<QuoteForm />);
    const [, toCountry] = await countriesLoaded();

    await userEvent.selectOptions(toCountry, "DE");
    expect(screen.getAllByLabelText(/Postal code/)[1]).toHaveAccessibleDescription("Required for this country.");
    await userEvent.type(screen.getAllByLabelText(/Postal code/)[1], "123");
    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(screen.getAllByLabelText(/Postal code/)[1]).toHaveAccessibleDescription(expect.stringContaining("not valid"));
  });

  it("clears measurements when the unit system changes, so numbers are never silently reinterpreted", async () => {
    renderWithClient(<QuoteForm />);
    await countriesLoaded();
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "2");

    await userEvent.click(screen.getByLabelText("Pounds and inches"));

    expect(screen.getByLabelText("Weight (lb)")).toHaveValue("");
    expect(screen.queryByLabelText("Weight (kg)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Length (in)")).toBeInTheDocument();
  });

  it("sends imperial measurements with imperial field names", async () => {
    api.createQuote.mockResolvedValue(quote());
    renderWithClient(<QuoteForm />);
    await fillValidForm();
    await userEvent.click(screen.getByLabelText("Pounds and inches"));
    await userEvent.type(screen.getByLabelText("Weight (lb)"), "10");
    await userEvent.type(screen.getByLabelText("Length (in)"), "12");
    await userEvent.type(screen.getByLabelText("Width (in)"), "8");
    await userEvent.type(screen.getByLabelText("Height (in)"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(api.createQuote.mock.calls[0][0]).toMatchObject({ unit_system: "imperial", packages: [{ weight_lb: "10", length_in: "12", width_in: "8", height_in: "4" }] });
  });

  it("adds and removes packages", async () => {
    renderWithClient(<QuoteForm />);
    await countriesLoaded();

    await userEvent.click(screen.getByRole("button", { name: "Add another package" }));
    expect(screen.getAllByRole("group", { name: /Package \d/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /Remove package 1/ }));
    expect(screen.getAllByRole("group", { name: /Package \d/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Remove package/ })).not.toBeInTheDocument();
  });

  it("shows the API's complaints beside the fields they belong to", async () => {
    api.createQuote.mockRejectedValue(new ApiError(422, "validation_failed", "The given data was invalid.", { "origin.city": ["We don't serve that city."], "packages.0.weight_kg": ["Too heavy."] }));
    renderWithClient(<QuoteForm />);
    await fillValidForm();

    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(await screen.findByText("We don't serve that city.")).toBeInTheDocument();
    expect(screen.getByText("Too heavy.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("explains throttling and network failures", async () => {
    api.createQuote.mockRejectedValue(new ApiError(429, "too_many_requests", "x"));
    renderWithClient(<QuoteForm />);
    await fillValidForm();

    await userEvent.click(screen.getByRole("button", { name: "Get prices" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("offers a retry when the country list cannot be loaded", async () => {
    api.fetchCountries.mockRejectedValue(new ApiError(0, "network", "x"));
    renderWithClient(<QuoteForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load the list of countries");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("QuoteView", () => {
  it("shows the total, the delivery estimate, and keeps estimated duties out of the total", () => {
    renderWithClient(<QuoteView quote={quote()} countries={COUNTRIES} />);
    const card = screen.getByRole("heading", { name: "International Economy" }).closest("li")!;

    expect(within(card).getByRole("heading", { name: "International Economy" })).toBeInTheDocument();
    expect(within(card).getByText(/Delivery in 7–13 days \(estimate\)/)).toBeInTheDocument();
    expect(within(card).getByLabelText(/Total .*70\.41/)).toBeInTheDocument();
    expect(within(card).getByText(/Not included: estimated import duties and taxes of about/)).toHaveTextContent("4.00");
    expect(within(card).getByText(/Demonstration service/)).toBeInTheDocument();
    expect(screen.getByText(/Lagos, Nigeria/)).toBeInTheDocument();
  });

  it("explains how the price is made up, marking estimates", () => {
    renderWithClient(<QuoteView quote={quote()} countries={COUNTRIES} />);
    const table = screen.getByRole("table", { name: "Price breakdown for International Economy" });

    expect(within(table).getByRole("rowheader", { name: "Transportation charge" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: /Import duty \(estimate\) — estimate, not in the total/ })).toBeInTheDocument();
    expect(screen.getByText(/Billed on 2 kg: actual 2 kg, volumetric 1.2 kg/)).toBeInTheDocument();
    expect(screen.getByText("You will need: Commercial invoice.")).toBeInTheDocument();
  });

  it("links each option to its booking", () => {
    renderWithClient(<QuoteView quote={quote({ options: [option(), option({ id: "OPT2", service: { slug: "x", name: "Express", category: null, is_demo: false } })] })} countries={COUNTRIES} />);

    expect(screen.getByRole("link", { name: "Book Express" })).toHaveAttribute("href", "/book/QUOTE1?option=OPT2");
    expect(screen.getByRole("link", { name: "Book International Economy" })).toHaveAttribute("href", "/book/QUOTE1?option=OPT1");
  });

  it("lists services that can't carry the shipment, with reasons in plain words", () => {
    renderWithClient(<QuoteView quote={quote()} countries={COUNTRIES} />);

    const unavailable = screen.getByText(/Services that can't carry this shipment \(1\)/).closest("details")!;
    expect(unavailable).toHaveTextContent("Air Freight");
    expect(unavailable).toHaveTextContent("doesn't carry this kind of shipment");
    expect(unavailable).toHaveTextContent("Not available (weird new reason).");
  });

  it("will not let anyone book expired prices", () => {
    renderWithClient(<QuoteView quote={quote({ status: "expired" })} countries={COUNTRIES} />);

    expect(screen.getByRole("alert")).toHaveTextContent("These prices have expired");
    expect(screen.getByRole("button", { name: "Prices expired" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /^Book / })).not.toBeInTheDocument();
  });

  it("treats a quote past its expiry time as expired even if the status has not caught up", () => {
    renderWithClient(<QuoteView quote={quote({ expires_at: new Date(Date.now() - 1000).toISOString() })} countries={COUNTRIES} />);

    expect(screen.getByRole("alert")).toHaveTextContent("expired");
  });

  it("says so when nothing can carry the shipment", () => {
    renderWithClient(<QuoteView quote={quote({ options: [] })} countries={COUNTRIES} />);

    expect(screen.getByRole("status")).toHaveTextContent("None of our services can carry this shipment");
  });

  it("shows currency conversion in the breakdown", () => {
    const converted = option({ exchange_rate: { from: "USD", to: "NGN", rate: "1500", source: "treasury", effective_at: null }, totals: { ...option().totals, total: money(1000000, "NGN") } });
    renderWithClient(<QuoteView quote={quote({ options: [converted] })} countries={COUNTRIES} />);

    expect(screen.getByText(/Converted from USD to NGN at 1500 \(treasury\)/)).toBeInTheDocument();
  });
});

describe("QuoteResults", () => {
  it("loads the quote by its id", async () => {
    api.fetchQuote.mockResolvedValue(quote());
    renderWithClient(<QuoteResults id="QUOTE1" />);

    expect(await screen.findByRole("heading", { name: "International Economy" })).toBeInTheDocument();
    expect(api.fetchQuote).toHaveBeenCalledWith("QUOTE1", expect.anything());
  });

  it("says plainly when the quote doesn't exist, without a pointless retry", async () => {
    api.fetchQuote.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<QuoteResults id="nope" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this quote");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new quote" })).toHaveAttribute("href", "/quote");
  });

  it("offers a retry for other failures", async () => {
    api.fetchQuote.mockRejectedValue(new ApiError(500, "server_error", "x"));
    renderWithClient(<QuoteResults id="q" />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
