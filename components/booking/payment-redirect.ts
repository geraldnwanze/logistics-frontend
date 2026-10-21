export type PaymentDestination = { kind: "internal"; path: string } | { kind: "external"; url: string };

/**
 * Where to send the customer to pay. The API supplies the checkout address; it is only followed if it is this
 * site's own sandbox page (re-built here so a bad address can't redirect anywhere) or an https provider page.
 * Anything else falls back to the shipment page, where payment can be started again.
 */
export function paymentDestination(actionUrl: string | null, shipmentId: string, siteOrigin: string): PaymentDestination {
  const fallback: PaymentDestination = { kind: "internal", path: `/shipments/${encodeURIComponent(shipmentId)}?payment=error` };
  if (!actionUrl) return fallback;

  try {
    const url = new URL(actionUrl, siteOrigin);

    if (url.origin === siteOrigin) {
      const reference = url.searchParams.get("reference");

      return url.pathname === "/sandbox-pay" && reference && /^[\w-]{6,100}$/.test(reference)
        ? { kind: "internal", path: `/sandbox-pay?reference=${encodeURIComponent(reference)}&shipment=${encodeURIComponent(shipmentId)}` }
        : fallback;
    }

    return url.protocol === "https:" ? { kind: "external", url: url.toString() } : fallback;
  } catch {
    return fallback;
  }
}
