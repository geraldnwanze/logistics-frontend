import { trackingResponseSchema, type Tracking } from "./schemas";

// Literal access so Next.js can inline the public variable into browser code.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type TrackingFailure = "not-found" | "rate-limited" | "unavailable" | "offline";

export class TrackingLookupError extends Error {
  constructor(readonly reason: TrackingFailure, readonly retryAfterSeconds?: number) {
    super(reason);
  }
}

/** The API's numbers are letters and digits only; people type dashes and spaces and mixed case. */
export function normaliseTrackingNumber(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

export async function fetchTracking(rawNumber: string, signal?: AbortSignal): Promise<Tracking> {
  const number = normaliseTrackingNumber(rawNumber);
  let response: Response;

  try {
    response = await fetch(`${API_ORIGIN}/api/v1/public/tracking/${encodeURIComponent(number)}`, { headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new TrackingLookupError("offline");
  }

  if (response.status === 404) throw new TrackingLookupError("not-found");
  if (response.status === 429) throw new TrackingLookupError("rate-limited", Number(response.headers.get("Retry-After")) || undefined);
  if (!response.ok) throw new TrackingLookupError("unavailable");

  const parsed = trackingResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new TrackingLookupError("unavailable");

  return parsed.data.data;
}
