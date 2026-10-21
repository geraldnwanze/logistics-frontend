import type { Tracking } from "@/lib/tracking/schemas";

export function trackingFixture(over: Partial<Tracking> = {}): Tracking {
  return {
    tracking_number: "LG000000000001", status: { code: "in_transit", label: "In transit" }, service: "International Economy", is_demo: true,
    origin: { city: "Lagos", country: "NG" }, destination: { city: "Berlin", country: "DE" },
    estimated_delivery: { earliest: "2026-10-20", latest: "2026-10-24" }, delivered_at: null, last_updated_at: "2026-10-13T10:00:00+00:00",
    timeline: [
      { id: "e1", status: { code: "booking_confirmed", label: "Booking confirmed" }, description: null, occurred_at: "2026-10-12T08:30:00+00:00", local_time: "2026-10-12T09:30:00+01:00", timezone: "Africa/Lagos", location: { city: "Lagos", country: "NG", facility: null }, source: "simulated", reason: null, delivered_to: null },
      { id: "e2", status: { code: "in_transit", label: "In transit" }, description: "Left the hub", occurred_at: "2026-10-14T08:00:00+00:00", local_time: "2026-10-14T10:00:00+02:00", timezone: "Europe/Berlin", location: { city: "Frankfurt", country: "DE", facility: "FRA hub" }, source: "simulated", reason: null, delivered_to: null },
    ],
    data_sources: ["simulated"], notice: "Some updates are simulated demonstration data.", ...over,
  };
}
