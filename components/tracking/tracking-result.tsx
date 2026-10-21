"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchTracking, normaliseTrackingNumber, TrackingLookupError } from "@/lib/tracking/api";
import { clearSaved, readSavedFor, saveTracking, type SavedTracking } from "@/lib/tracking/saved";
import type { Tracking, TrackingEvent } from "@/lib/tracking/schemas";

function formatInZone(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(iso)) + " UTC";
  }
}

function place(city: string | null, country: string | null): string {
  return [city, country].filter(Boolean).join(", ") || "—";
}

const FAILURE_MESSAGES: Record<string, string> = {
  "not-found": "We couldn't find a shipment with that tracking number. Check it and try again.",
  "rate-limited": "Too many lookups in a short time. Please wait a minute and try again.",
  unavailable: "Tracking is temporarily unavailable. Please try again shortly.",
  offline: "You appear to be offline, so we can't look up this number right now.",
};

/**
 * Fetches live tracking in the browser (so it is never older than the API's 15-second cache) and keeps the last
 * few results on the device. If the network fails, the saved copy is shown with its age instead of an error.
 */
export function TrackingResult({ number: rawNumber }: { number: string }) {
  const number = normaliseTrackingNumber(rawNumber);
  const [saved, setSaved] = useState<SavedTracking | null>(null);
  const query = useQuery({
    queryKey: ["tracking", number],
    queryFn: ({ signal }) => fetchTracking(number, signal),
    retry: false,
    staleTime: 15_000,
  });

  useEffect(() => {
    // Read after mount: localStorage does not exist during the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(readSavedFor(number));
  }, [number]);

  useEffect(() => {
    if (query.data) saveTracking(number, query.data);
  }, [number, query.data]);

  const error = query.error instanceof TrackingLookupError ? query.error : null;
  const unreachable = error !== null && (error.reason === "offline" || error.reason === "unavailable");
  const live = query.data ?? null;
  const stale = !live && unreachable ? saved : null;
  const shown = live ?? stale?.tracking ?? null;

  if (query.isPending) {
    return <p role="status" className="mt-6">Looking up {number}…</p>;
  }

  if (!shown) {
    return (
      <div role="alert" className="mt-6 rounded-md border border-foreground/20 p-4">
        <p>{FAILURE_MESSAGES[error?.reason ?? "unavailable"]}</p>
        {error?.reason === "rate-limited" && error.retryAfterSeconds ? <p className="mt-1 text-sm opacity-75">Try again in about {error.retryAfterSeconds} seconds.</p> : null}
        {unreachable ? <Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button> : null}
      </div>
    );
  }

  return (
    <div className="mt-6">
      {stale ? (
        <p role="status" className="mb-4 rounded-md border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">
          Showing the copy saved on this device on {formatInZone(stale.savedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}. We can&apos;t reach the tracking service, so newer updates may be missing.
          <Button className="ml-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Refresh</Button>
        </p>
      ) : null}
      <TrackingDetails tracking={shown} />
      <p className="mt-6 text-xs opacity-70">
        A copy of this result is kept in this browser so you can read it offline.{" "}
        <button type="button" className="underline" onClick={() => { clearSaved(); setSaved(null); }}>Remove saved tracking</button>
      </p>
    </div>
  );
}

export function TrackingDetails({ tracking }: { tracking: Tracking }) {
  const events = [...tracking.timeline].reverse();

  return (
    <article aria-labelledby="tracking-status">
      {tracking.is_demo ? (
        <p className="mb-4 rounded-md border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">Demonstration shipment: this is sample data, not a real parcel.</p>
      ) : null}
      <p className="text-sm opacity-75">Tracking number <span className="break-all font-mono">{tracking.tracking_number}</span></p>
      <h2 id="tracking-status" className="mt-1 text-2xl font-semibold">{tracking.status.label}</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="opacity-70">From</dt><dd>{place(tracking.origin.city, tracking.origin.country)}</dd></div>
        <div><dt className="opacity-70">To</dt><dd>{place(tracking.destination.city, tracking.destination.country)}</dd></div>
        {tracking.service ? <div><dt className="opacity-70">Service</dt><dd>{tracking.service}</dd></div> : null}
        {tracking.delivered_at ? (
          <div><dt className="opacity-70">Delivered</dt><dd>{formatInZone(tracking.delivered_at, "UTC")} UTC</dd></div>
        ) : tracking.estimated_delivery ? (
          <div><dt className="opacity-70">Estimated delivery</dt><dd>{tracking.estimated_delivery.earliest} to {tracking.estimated_delivery.latest} <span className="opacity-70">(estimate)</span></dd></div>
        ) : null}
      </dl>
      {tracking.notice ? <p className="mt-4 text-sm opacity-80">{tracking.notice}</p> : null}

      <h3 className="mt-8 text-lg font-semibold">History</h3>
      <ol className="mt-3 space-y-4 border-l-2 border-foreground/15 pl-4">
        {events.map((event) => <TimelineEntry key={event.id} event={event} />)}
      </ol>
    </article>
  );
}

function TimelineEntry({ event }: { event: TrackingEvent }) {
  const where = [event.location.facility, event.location.city, event.location.country].filter(Boolean).join(", ");

  return (
    <li>
      <p className="font-medium">{event.status.label}</p>
      <p className="text-sm opacity-75"><time dateTime={event.occurred_at}>{formatInZone(event.occurred_at, event.timezone)}</time> <span className="opacity-70">({event.timezone})</span></p>
      {where ? <p className="text-sm">{where}</p> : null}
      {event.description ? <p className="text-sm">{event.description}</p> : null}
      {event.reason ? <p className="text-sm">Reason: {event.reason}</p> : null}
      {event.delivered_to ? <p className="text-sm">Received by {event.delivered_to}</p> : null}
    </li>
  );
}
