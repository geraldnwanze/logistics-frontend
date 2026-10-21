/**
 * Exact decimal handling for the booking form's "items must add up to the declared value" check. Amounts are
 * strings turned into whole minor units with integer arithmetic: floating point is never used for money.
 */
export function decimalPlaces(amount: string): number {
  return amount.split(".")[1]?.length ?? 0;
}

/** "12.50" with 2 decimals becomes BigInt(1250); null if it is not a plain amount or has too many decimals. */
export function toMinor(amount: string, decimals: number): bigint | null {
  const value = amount.trim();
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(value)) return null;

  const [whole, fraction = ""] = value.split(".");
  if (fraction.replace(/0+$/, "").length > decimals) return null;

  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0");
}

export function formatMinor(minor: bigint, decimals: number, currency: string): string {
  const text = minor.toString().padStart(decimals + 1, "0");
  const amount = decimals === 0 ? text : `${text.slice(0, -decimals)}.${text.slice(-decimals)}`;

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: decimals }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
