import { z } from "zod";

const place = z.object({ city: z.string().nullable(), country: z.string().nullable() });
const status = z.object({ code: z.string(), label: z.string() });

export const trackingEventSchema = z.object({
  id: z.string(),
  status,
  description: z.string().nullable(),
  occurred_at: z.string(),
  local_time: z.string(),
  timezone: z.string(),
  location: z.object({ city: z.string().nullable(), country: z.string().nullable(), facility: z.string().nullable() }),
  source: z.string(),
  reason: z.string().nullable(),
  delivered_to: z.string().nullable(),
});

/** Exactly what GET /api/v1/public/tracking/{number} approves for the public; nothing else is read or stored. */
export const trackingSchema = z.object({
  tracking_number: z.string(),
  status,
  service: z.string().nullable(),
  is_demo: z.boolean(),
  origin: place,
  destination: place,
  estimated_delivery: z.object({ earliest: z.string(), latest: z.string() }).nullable(),
  delivered_at: z.string().nullable(),
  last_updated_at: z.string().nullable(),
  timeline: z.array(trackingEventSchema),
  data_sources: z.array(z.string()),
  notice: z.string().nullable(),
});

export const trackingResponseSchema = z.object({ data: trackingSchema });

export type Tracking = z.infer<typeof trackingSchema>;
export type TrackingEvent = z.infer<typeof trackingEventSchema>;
