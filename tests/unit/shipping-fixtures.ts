import type { Country, Quote, QuoteOption, Shipment } from "@/lib/shipping/schemas";

export const money = (minor: number, currency = "USD") => ({ amount_minor: minor, amount: (minor / 100).toFixed(2), currency });

export const COUNTRIES: Country[] = [
  { code: "DE", name: "Germany", dial_code: "+49", currency_code: "EUR", postal_code_required: true, postal_code_pattern: "^\\d{5}$", state_required: false, state_label: "State (optional)" },
  { code: "NG", name: "Nigeria", dial_code: "+234", currency_code: "NGN", postal_code_required: false, postal_code_pattern: "^\\d{6}$", state_required: true, state_label: "State" },
  { code: "US", name: "United States", dial_code: "+1", currency_code: "USD", postal_code_required: true, postal_code_pattern: "^\\d{5}(-\\d{4})?$", state_required: true, state_label: "State" },
];

export function option(over: Partial<QuoteOption> = {}): QuoteOption {
  return {
    id: "OPT1", service: { slug: "international-economy", name: "International Economy", category: "economy", is_demo: true },
    estimated_delivery: { min_days: 7, max_days: 13 }, weights: { actual_g: 2000, volumetric_g: 1200, billable_g: 2000, volumetric_divisor: 5000 },
    line_items: [
      { kind: "base", code: "base", label: "Transportation charge", is_estimate: false, amount: money(5840) },
      { kind: "duty_estimate", code: "import_duty", label: "Import duty (estimate)", is_estimate: true, amount: money(400) },
    ],
    totals: { charges: money(6541), tax: money(0), insurance: money(500), total: money(7041), estimated_duties_and_import_taxes: money(400) },
    exchange_rate: null, restrictions: [], required_documents: ["Commercial invoice"], assumptions: ["Duties are estimates."], ...over,
  };
}

export function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: "QUOTE1", status: "active", currency: "USD", expires_at: new Date(Date.now() + 3_600_000).toISOString(), accepted_option_id: null,
    shipment: { origin: { country: "NG", city: "Lagos", postal: "100001" }, destination: { country: "DE", city: "Berlin", postal: "10115" }, shipment_type: "parcel", contents: "Clothing", package_count: 1, declared_value: money(10000) },
    options: [option()], unavailable: [{ service: "air-freight", name: "Air Freight", reasons: ["shipment_type_not_supported", "weird_new_reason"] }], ...over,
  };
}

export function shipment(over: Partial<Shipment> = {}): Shipment {
  const party = { company: null, email: null, line2: null, state: null, postal_code: null };

  return {
    id: "01SHIP000001AAAAAA", tracking_number: "LG000000000001", status: "booking_pending", status_label: "Booking pending", is_demo: true,
    service: { slug: "international-economy", name: "International Economy" }, estimated_delivery: { min_days: 7, max_days: 13 }, total: money(7041),
    payment: { method: "prepaid", status: "issued", invoice_id: "INV", invoice_number: "INV-2026-000001", requires_payment: true },
    sender: { ...party, name: "Ife Okoro", phone: "+2348012345678", line1: "1 Marina Road", city: "Lagos", country: "NG" },
    recipient: { ...party, name: "Hans Becker", phone: "+4915112345678", line1: "2 Unter den Linden", city: "Berlin", country: "DE", postal_code: "10115" },
    contents: "Clothing", items: [{ description: "Cotton shirts", quantity: 2, unit_value_minor: 5000, currency: "USD", hs_code: "6205", origin_country: "NG" }],
    required_documents: ["Commercial invoice"], documents: [], cancellable: true, created_at: "2026-10-16T08:00:00Z", ...over,
  };
}

export function invoice(over: Partial<import("@/lib/shipping/schemas").Invoice> = {}): import("@/lib/shipping/schemas").Invoice {
  return {
    id: "INV1", number: "INV-2026-000001", status: "paid", kind: "prepaid", shipment_id: "01SHIP000001AAAAAA", tracking_number: "LG000000000001",
    subtotal: money(7041), tax: money(0), total: money(7041), refunded: money(0), billing_name: "Ife Okoro", issued_at: "2026-10-16T08:00:00Z", due_at: null, paid_at: "2026-10-16T08:05:00Z",
    items: [{ kind: "base", description: "Transportation charge", amount: money(6541) }, { kind: "insurance", description: "Insurance", amount: money(500) }], credit_notes: [], ...over,
  };
}

export const paged = <T,>(items: T[], over: Partial<{ page: number; lastPage: number; total: number }> = {}) => ({ items, page: 1, lastPage: 1, total: items.length, ...over });

export function customs(over: Partial<import("@/lib/shipping/schemas").Customs> = {}): import("@/lib/shipping/schemas").Customs {
  return {
    international: true, declaration: null,
    requirements: [
      { id: 1, direction: "export", document_type: "export_licence", label: "Export licence", mandatory: true, notes: "Needed for goods over $1,000.", status: "missing", reason: "No export licence on file." },
      { id: 2, direction: "import", document_type: "commercial_invoice", label: "Commercial invoice", mandatory: true, notes: null, status: "missing", reason: "No commercial invoice on file." },
      { id: 3, direction: "import", document_type: "packing_list", label: "Packing list", mandatory: false, notes: null, status: "satisfied", reason: null },
    ],
    ready_for_export: false, compliance: { status: "clear", note: null },
    estimates: { note: "Estimates from your quote. They are not charges and not included in what you paid; the amounts customs actually assess may differ.", items: [{ label: "Import duty (estimate)", amount_minor: 400, currency: "USD" }] },
    assessed_charges: { note: "Amounts assessed by the customs authority of the destination country, payable separately from your shipping invoice.", items: [] }, ...over,
  };
}
