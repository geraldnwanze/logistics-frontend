import type { Money } from "./schemas";

/** Display only: the API's decimal string is formatted for reading and never parsed back or used in sums. */
export function formatMoney(money: Money, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency, minimumFractionDigits: money.amount.split(".")[1]?.length ?? 0 }).format(Number(money.amount));
  } catch {
    return `${money.amount} ${money.currency}`;
  }
}

export function formatDays(range: { min_days: number; max_days: number }): string {
  return range.min_days === range.max_days ? `${range.min_days} days` : `${range.min_days}–${range.max_days} days`;
}

export function formatKg(grams: number): string {
  return `${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

const REASONS: Record<string, string> = {
  route_not_served: "This service doesn't run between these places.",
  shipment_type_not_supported: "This service doesn't carry this kind of shipment.",
  package_too_light: "The shipment is lighter than this service's minimum.",
  package_too_heavy: "The shipment is heavier than this service allows.",
  package_too_large: "A package is larger than this service allows.",
  too_many_packages: "There are more packages than this service accepts.",
  declared_value_too_high: "The declared value is above this service's limit.",
  weight_not_covered: "The weight isn't covered by this service's price list.",
};

export function describeUnavailable(code: string): string {
  return REASONS[code] ?? `Not available (${code.replace(/_/g, " ")}).`;
}

export function countryName(code: string, countries: { code: string; name: string }[] | undefined): string {
  return countries?.find((c) => c.code === code)?.name ?? code;
}

export type Tone = "good" | "bad" | "warn" | "plain";

/** How to colour a shipment status chip. Colour is never the only signal: the label is always shown. */
export function statusTone(status: string): Tone {
  if (status === "delivered") return "good";
  if (status === "cancelled" || status === "returned_to_sender") return "bad";
  if (["exception", "customs_hold", "customs_charges_due", "delivery_attempted"].includes(status)) return "warn";

  return "plain";
}

export function invoiceLabel(invoice: { status: string; kind: string; total: Money; refunded: Money }): { text: string; tone: Tone } {
  const refunded = invoice.refunded.amount_minor;
  if (refunded > 0) return refunded >= invoice.total.amount_minor ? { text: "Refunded", tone: "plain" } : { text: "Partly refunded", tone: "warn" };
  if (invoice.status === "paid") return { text: "Paid", tone: "good" };
  if (invoice.status === "void") return { text: "Cancelled", tone: "bad" };
  if (invoice.status === "issued") return invoice.kind === "invoiced" ? { text: "Payment due", tone: "warn" } : { text: "Awaiting payment", tone: "warn" };

  return { text: invoice.status.replace(/_/g, " "), tone: "plain" };
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}
