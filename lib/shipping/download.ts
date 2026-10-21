import { API_ORIGIN, ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { fetchInvoiceLink } from "./api";

/** The link must point at our own API: it is signed server-side, and anything else is not something to navigate to. */
export function isApiUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(API_ORIGIN).origin;
  } catch {
    return false;
  }
}

/**
 * Fetches a short-lived signed link and starts the download. The API answers with "attachment", so the browser
 * saves the file and the page stays where it is. Returns a message to show if it failed, otherwise null.
 */
export async function downloadInvoice(invoiceId: string, shipmentId?: string, navigate: (url: string) => void = (url) => window.location.assign(url)): Promise<string | null> {
  try {
    const link = await fetchInvoiceLink(invoiceId, shipmentId);
    if (!isApiUrl(link.url)) return "We couldn't prepare the download. Please try again.";

    navigate(link.url);

    return null;
  } catch (caught) {
    return caught instanceof ApiError && caught.status === 404 ? "We couldn't find this invoice." : describeError(caught);
  }
}

/** Starts a download from a freshly fetched signed link, turning any failure into a message for the page. */
export async function openSignedLink(getLink: () => Promise<{ url: string }>, navigate: (url: string) => void = (url) => window.location.assign(url)): Promise<string | null> {
  try {
    const link = await getLink();
    if (!isApiUrl(link.url)) return "We couldn't prepare the download. Please try again.";

    navigate(link.url);

    return null;
  } catch (caught) {
    return caught instanceof ApiError && caught.status === 404 ? "We couldn't find that document." : describeError(caught);
  }
}
