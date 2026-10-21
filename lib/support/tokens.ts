/**
 * Guests get one-time tokens when they open a ticket (and use the shipment's token for claims). Like the
 * shipment token they are bearer secrets: kept in this tab's sessionStorage only, sent as headers, never in a URL.
 */
const ticketKey = (ticketId: string) => `ticket-token:${ticketId}`;
const claimKey = (claimId: string) => `claim-shipment:${claimId}`;

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: the guest keeps the email thread instead */
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export const rememberTicketToken = (ticketId: string, token: string) => write(ticketKey(ticketId), token);
export const ticketTokenFor = (ticketId: string) => read(ticketKey(ticketId));

/** A claim has no token of its own; a guest reaches it through the shipment's token, so we remember which shipment it was filed on. */
export const rememberClaimShipment = (claimId: string, shipmentId: string) => write(claimKey(claimId), shipmentId);
export const claimShipmentFor = (claimId: string) => read(claimKey(claimId));

export function forgetSupportTokens(): void {
  try {
    for (const name of Object.keys(sessionStorage)) if (name.startsWith("ticket-token:") || name.startsWith("claim-shipment:")) sessionStorage.removeItem(name);
  } catch {
    /* nothing to forget */
  }
}
