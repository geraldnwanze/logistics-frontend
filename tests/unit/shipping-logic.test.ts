import { describe, expect, it } from "vitest";
import { declaredOf, emptyItem, toBookingInput, validateBooking, type BookingDraft } from "@/components/booking/booking-flow";
import { emptyParty } from "@/components/booking/party-fields";
import { paymentDestination } from "@/components/booking/payment-redirect";
import { emptyPackage, postalProblem, toQuoteInput, validateQuote, type QuoteDraft } from "@/components/quote/quote-form";
import { describeUnavailable, formatDays, formatKg, formatMoney } from "@/lib/shipping/format";
import { decimalPlaces, formatMinor, toMinor } from "@/lib/shipping/money";
import { COUNTRIES, money, quote } from "./shipping-fixtures";

describe("exact money", () => {
  it.each([["12.50", 2, "1250"], ["0.1", 2, "10"], ["100", 2, "10000"], ["5", 0, "5"], ["1.250", 2, "125"], ["0.07", 2, "7"]])("%s with %i decimals is %s minor units", (amount, decimals, expected) => {
    expect(toMinor(amount, decimals)?.toString()).toBe(expected);
  });

  it.each([["1.234", 2], ["12.5", 0], ["abc", 2], ["", 2], ["-1", 2], ["1,5", 2], ["1e3", 2], ["1234567890123", 2]])("refuses %j with %i decimals", (amount, decimals) => {
    expect(toMinor(amount, decimals)).toBeNull();
  });

  it("adds up with no floating point drift", () => {
    const parts = ["0.10", "0.20", "0.30"].map((v) => toMinor(v, 2)!);

    expect(parts.reduce((a, b) => a + b, BigInt(0)).toString()).toBe("60");   // 0.1 + 0.2 + 0.3 is 0.6000000000000001 as floats
  });

  it("counts decimals and formats minor units back", () => {
    expect(decimalPlaces("250.50")).toBe(2);
    expect(decimalPlaces("250")).toBe(0);
    expect(formatMinor(BigInt(25050), 2, "USD")).toContain("250.50");
    expect(formatMinor(BigInt(5), 2, "USD")).toContain("0.05");
    expect(formatMinor(BigInt(500), 0, "JPY")).toContain("500");
  });
});

describe("display helpers", () => {
  it("formats API amounts without parsing them for arithmetic", () => {
    expect(formatMoney(money(7041))).toContain("70.41");
    expect(formatMoney({ amount_minor: 1, amount: "1", currency: "XXX-bad" })).toBe("1 XXX-bad");
  });

  it("formats delivery windows and weights", () => {
    expect(formatDays({ min_days: 7, max_days: 13 })).toBe("7–13 days");
    expect(formatDays({ min_days: 2, max_days: 2 })).toBe("2 days");
    expect(formatKg(2000)).toBe("2 kg");
    expect(formatKg(1250)).toBe("1.25 kg");
  });

  it("explains why a service can't carry the shipment, with a safe fallback for new reasons", () => {
    expect(describeUnavailable("route_not_served")).toMatch(/doesn't run between/);
    expect(describeUnavailable("brand_new_reason")).toBe("Not available (brand new reason).");
  });
});

const quoteDraft = (over: Partial<QuoteDraft> = {}): QuoteDraft => ({
  origin: { country: "NG", city: "Lagos", postal: "" }, destination: { country: "DE", city: "Berlin", postal: "10115" }, type: "parcel", contents: "Clothing", unit: "metric",
  packages: [{ ...emptyPackage(), weight: "2", length: "30", width: "20", height: "10" }], declaredAmount: "100", declaredCurrency: "USD", insurance: false, ...over,
});

describe("postalProblem", () => {
  const de = COUNTRIES.find((c) => c.code === "DE");
  const ng = COUNTRIES.find((c) => c.code === "NG");

  it("requires, accepts and rejects postal codes by the country's rules", () => {
    expect(postalProblem(de, "")).toMatch(/required/);
    expect(postalProblem(de, "10115")).toBeNull();
    expect(postalProblem(de, "1011")).toMatch(/not valid/);
    expect(postalProblem(ng, "")).toBeNull();
    expect(postalProblem(undefined, "anything")).toBeNull();
  });

  it("never blocks a customer because a pattern from the API is unreadable", () => {
    expect(postalProblem({ ...de!, postal_code_pattern: "([" }, "10115")).toBeNull();
  });
});

describe("validateQuote", () => {
  it("accepts a complete request", () => {
    expect(validateQuote(quoteDraft(), COUNTRIES)).toEqual({});
  });

  it("uses the API's field names so server and client errors line up", () => {
    const errors = validateQuote(quoteDraft({ origin: { country: "", city: " ", postal: "" }, destination: { country: "DE", city: "Berlin", postal: "" }, contents: " ", packages: [emptyPackage()] }), COUNTRIES);

    expect(errors).toMatchObject({
      "origin.country": expect.any(String), "origin.city": expect.any(String), "destination.postal_code": expect.stringContaining("required"), contents: expect.any(String),
      "packages.0.weight_kg": "Required.", "packages.0.length_cm": "Required.",
    });
  });

  it("checks measurements for the chosen unit system", () => {
    const imperial = quoteDraft({ unit: "imperial", packages: [{ ...emptyPackage(), weight: "10", length: "12.25", width: "8", height: "4" }] });

    expect(validateQuote(imperial, COUNTRIES)).toEqual({});
    expect(validateQuote({ ...imperial, unit: "metric" }, COUNTRIES)["packages.0.length_cm"]).toMatch(/decimal/);
    expect(validateQuote(quoteDraft({ packages: [{ ...emptyPackage(), weight: "0", length: "30", width: "20", height: "10" }] }), COUNTRIES)["packages.0.weight_kg"]).toBe("Must be greater than zero.");
    expect(validateQuote(quoteDraft({ packages: [{ ...emptyPackage(), weight: "1.2345", length: "30", width: "20", height: "10" }] }), COUNTRIES)).toHaveProperty("packages.0.weight_kg");
  });

  it("needs a currency and a plain amount when a value is declared", () => {
    expect(validateQuote(quoteDraft({ declaredAmount: "12,5" }), COUNTRIES)).toHaveProperty(["declared_value.amount"]);
    expect(validateQuote(quoteDraft({ declaredAmount: "100", declaredCurrency: "" }), COUNTRIES)).toHaveProperty(["declared_value.currency"]);
    expect(validateQuote(quoteDraft({ declaredAmount: "" }), COUNTRIES)).toEqual({});
  });
});

describe("toQuoteInput", () => {
  it("builds the API request with the unit system's field names and leaves out what was not given", () => {
    const metric = toQuoteInput(quoteDraft({ declaredAmount: "", insurance: true }));

    expect(metric).toMatchObject({ unit_system: "metric", insurance: true, packages: [{ type: "box", weight_kg: "2", length_cm: "30", width_cm: "20", height_cm: "10" }] });
    expect(metric.origin).toEqual({ country: "NG", city: "Lagos" });
    expect(metric).not.toHaveProperty("declared_value");

    const imperial = toQuoteInput(quoteDraft({ unit: "imperial", packages: [{ ...emptyPackage(), weight: "10", length: "12", width: "8", height: "4" }] }));
    expect(imperial.packages[0]).toMatchObject({ weight_lb: "10", length_in: "12", width_in: "8", height_in: "4" });
    expect(imperial.packages[0]).not.toHaveProperty("weight_kg");
    expect(imperial.declared_value).toEqual({ amount: "100", currency: "USD" });
  });
});

const bookingDraft = (over: Partial<BookingDraft> = {}): BookingDraft => ({
  contactEmail: "ife@example.test",
  sender: { ...emptyParty("NG", "Lagos", "100001"), name: "Ife Okoro", phone: "+2348012345678", line1: "1 Marina Road", state: "Lagos" },
  recipient: { ...emptyParty("DE", "Berlin", "10115"), name: "Hans Becker", phone: "+4915112345678", line1: "2 Unter den Linden" },
  items: [{ ...emptyItem("NG"), description: "Cotton shirts", quantity: "2", unit_value: "50.00" }],
  deliveryInstructions: "", pickup: false, pickupDate: "2026-10-20", pickupStart: "09:00", pickupEnd: "17:00", pickupInstructions: "", terms: true, ...over,
});

describe("validateBooking", () => {
  const q = quote();

  it("accepts a complete booking whose items match the declared value", () => {
    expect(validateBooking(bookingDraft(), q, COUNTRIES, false, "2026-10-16")).toEqual({});
  });

  it("insists on contact email only for guests", () => {
    expect(validateBooking(bookingDraft({ contactEmail: "" }), q, COUNTRIES, false, "2026-10-16")).toHaveProperty("contact_email");
    expect(validateBooking(bookingDraft({ contactEmail: "" }), q, COUNTRIES, true, "2026-10-16")).toEqual({});
  });

  it("applies each country's state and postal rules to each party", () => {
    const errors = validateBooking(bookingDraft({ sender: { ...bookingDraft().sender, state: "" }, recipient: { ...bookingDraft().recipient, postal_code: "123" } }), q, COUNTRIES, false, "2026-10-16");

    expect(errors["sender.state"]).toBe("State is required for this country.");
    expect(errors["recipient.postal_code"]).toMatch(/not valid/);
  });

  it("checks names, phone numbers and addresses", () => {
    const errors = validateBooking(bookingDraft({ sender: { ...bookingDraft().sender, name: " ", phone: "abc", line1: "", email: "nope" } }), q, COUNTRIES, false, "2026-10-16");

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["sender.name", "sender.phone", "sender.line1", "sender.email"]));
  });

  it("requires the items to add up exactly to the declared value, to the cent", () => {
    const off = validateBooking(bookingDraft({ items: [{ ...emptyItem("NG"), description: "x", quantity: "3", unit_value: "33.33" }] }), q, COUNTRIES, false, "2026-10-16");

    expect(off.items).toMatch(/99\.99[\s\S]*100\.00[\s\S]*must match/);
    expect(validateBooking(bookingDraft({ items: [{ ...emptyItem("NG"), description: "a", quantity: "1", unit_value: "33.33" }, { ...emptyItem("NG"), description: "b", quantity: "1", unit_value: "66.67" }] }), q, COUNTRIES, false, "2026-10-16")).toEqual({});
  });

  it("does not enforce a total when nothing was declared", () => {
    const none = quote({ shipment: { ...q.shipment, declared_value: money(0) } });

    expect(validateBooking(bookingDraft({ items: [{ ...emptyItem("NG"), description: "x", quantity: "1", unit_value: "7.00" }] }), none, COUNTRIES, false, "2026-10-16")).toEqual({});
  });

  it("checks each item's fields", () => {
    const errors = validateBooking(bookingDraft({ items: [{ description: "", quantity: "0", unit_value: "1.234", hs_code: "12", origin_country: "" }] }), q, COUNTRIES, false, "2026-10-16");

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["items.0.description", "items.0.quantity", "items.0.unit_value", "items.0.hs_code", "items.0.origin_country"]));
    expect(errors).not.toHaveProperty("items");   // the total is only compared once each line is valid
  });

  it("checks the collection window only when collection is wanted", () => {
    expect(validateBooking(bookingDraft({ pickupDate: "2020-01-01", pickupEnd: "08:00" }), q, COUNTRIES, false, "2026-10-16")).toEqual({});

    const errors = validateBooking(bookingDraft({ pickup: true, pickupDate: "2026-10-01", pickupEnd: "08:00" }), q, COUNTRIES, false, "2026-10-16");
    expect(errors["pickup.date"]).toBeDefined();
    expect(errors["pickup.window_end"]).toBe("The end must be after the start.");
  });

  it("will not book without accepting the terms", () => {
    expect(validateBooking(bookingDraft({ terms: false }), q, COUNTRIES, false, "2026-10-16")).toHaveProperty("terms_accepted");
  });
});

describe("toBookingInput", () => {
  it("sends trimmed values, drops empty optional fields, and never sends money as a float", () => {
    const input = toBookingInput(bookingDraft({ deliveryInstructions: "  Leave at reception ", items: [{ ...emptyItem("NG"), description: " Cotton shirts ", quantity: "2", unit_value: "50.00", hs_code: " 6205 " }] }), quote(), "OPT1", true);

    expect(input).toMatchObject({ quote_id: "QUOTE1", option_id: "OPT1", delivery_instructions: "Leave at reception", terms_accepted: true });
    expect(input.items[0]).toEqual({ description: "Cotton shirts", quantity: 2, unit_value: "50.00", origin_country: "NG", hs_code: "6205" });
    expect(input.sender).not.toHaveProperty("company");
    expect(input.sender).toMatchObject({ state: "Lagos", postal_code: "100001" });
    expect(input).not.toHaveProperty("pickup");
  });

  it("includes the collection window when asked for", () => {
    expect(toBookingInput(bookingDraft({ pickup: true, pickupInstructions: " Gate B " }), quote(), "OPT1", false).pickup).toEqual({ date: "2026-10-20", window_start: "09:00", window_end: "17:00", instructions: "Gate B" });
  });

  it("always sends a contact email for guests", () => {
    expect(toBookingInput(bookingDraft({ contactEmail: "" }), quote(), "OPT1", false)).toHaveProperty("contact_email", "");
    expect(toBookingInput(bookingDraft({ contactEmail: "" }), quote(), "OPT1", true)).not.toHaveProperty("contact_email");
  });
});

describe("declaredOf", () => {
  it("reads currency and precision from the quote, defaulting to the quote's currency when nothing was declared", () => {
    expect(declaredOf(quote())).toMatchObject({ minor: BigInt(10000), decimals: 2, currency: "USD" });
    expect(declaredOf(quote({ currency: "EUR", shipment: { ...quote().shipment, declared_value: null } }))).toMatchObject({ minor: BigInt(0), currency: "EUR" });
  });
});

describe("paymentDestination", () => {
  const origin = "https://www.example.test";

  it("keeps the customer on this site's sandbox page, rebuilt from the reference only", () => {
    expect(paymentDestination("https://www.example.test/sandbox-pay?reference=sbx_abc123&evil=1", "SHIP1", origin)).toEqual({ kind: "internal", path: "/sandbox-pay?reference=sbx_abc123&shipment=SHIP1" });
  });

  it("follows a real provider's https checkout page", () => {
    expect(paymentDestination("https://checkout.provider.test/pay/abc", "SHIP1", origin)).toEqual({ kind: "external", url: "https://checkout.provider.test/pay/abc" });
  });

  it.each([null, "", "javascript:alert(1)", "http://checkout.provider.test/pay", "https://www.example.test/elsewhere?reference=sbx_abc123", "https://www.example.test/sandbox-pay?reference=%3Cx%3E", "not a url at all", "data:text/html,hi"])("falls back to the shipment page for %j", (url) => {
    expect(paymentDestination(url, "SHIP1", origin)).toEqual({ kind: "internal", path: "/shipments/SHIP1?payment=error" });
  });
});
