/**
 * Guests get a one-time access token when they book. It is a bearer secret, so it lives in this tab's
 * sessionStorage only (gone when the tab closes) and is sent as a header, never put in a URL.
 */
const key = (shipmentId: string) => `guest-token:${shipmentId}`;

export function rememberGuestToken(shipmentId: string, token: string): void {
  try {
    sessionStorage.setItem(key(shipmentId), token);
  } catch {
    /* storage blocked: the guest can still track with the public tracking number */
  }
}

export function guestTokenFor(shipmentId: string): string | null {
  try {
    return sessionStorage.getItem(key(shipmentId));
  } catch {
    return null;
  }
}

export function forgetGuestTokens(): void {
  try {
    for (const name of Object.keys(sessionStorage)) if (name.startsWith("guest-token:")) sessionStorage.removeItem(name);
  } catch {
    /* nothing to forget */
  }
}
