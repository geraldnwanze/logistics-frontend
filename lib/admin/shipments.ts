import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";
import { moneySchema } from "@/lib/shipping/schemas";
import { assigneeSchema, type Assignee } from "./schemas";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

const place = z.object({ city: z.string().nullable(), country: z.string().nullable() });
const statusSchema = z.object({ code: z.string(), label: z.string() });

export const shipmentRowSchema = z.object({
  id: z.string(),
  tracking_number: z.string(),
  status: statusSchema,
  service: z.string(),
  created_at: z.string(),
  status_changed_at: z.string().nullable(),
  origin: place,
  destination: place,
  total: moneySchema,
  payment_status: z.string().nullable(),
  assigned_to: z.string().nullable(),
  assignee: assigneeSchema.nullish().transform((v) => v ?? null),
  facility: z.string().nullable(),
  delayed: z.boolean(),
  compliance_status: z.string().default("clear"),
  customer: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
});
export type ShipmentRow = z.infer<typeof shipmentRowSchema>;

const party = z.union([
  z.object({ redacted: z.literal(true), city: z.string().nullable(), country: z.string().nullable() }),
  z.object({ name: z.string(), company: z.string().nullish(), phone: z.string().nullish(), email: z.string().nullish(), line1: z.string(), line2: z.string().nullish(), city: z.string(), state: z.string().nullish(), postal_code: z.string().nullish(), country: z.string() }),
]);
export type Party = z.infer<typeof party>;

export const trackingEventSchema = z.object({
  id: z.string(),
  status: statusSchema,
  description: z.string().nullable(),
  occurred_at: z.string(),
  timezone: z.string(),
  location: z.object({ city: z.string().nullable(), country: z.string().nullable(), facility: z.string().nullable() }),
  source: z.string(),
  reason: z.string().nullable(),
  internal_note: z.string().nullable(),
  is_public: z.boolean(),
  applied: z.boolean(),
  rejection_reason: z.string().nullable(),
  recipient_name: z.string().nullable(),
});
export type TrackingEvent = z.infer<typeof trackingEventSchema>;

export const staffTrackingSchema = z.object({
  tracking_number: z.string(),
  status: statusSchema,
  international: z.boolean(),
  allowed_next: z.array(statusSchema),
  events: z.array(trackingEventSchema),
});
export type StaffTracking = z.infer<typeof staffTrackingSchema>;

export const shipmentDetailSchema = shipmentRowSchema.extend({
  sender: party.nullable(),
  recipient: party.nullable(),
  contents: z.string(),
  declared_value: z.object({ amount_minor: z.number(), currency: z.string() }),
  insurance_requested: z.boolean(),
  billable_weight_g: z.number(),
  packages: z.array(z.object({ type: z.string().nullish(), weight_g: z.number(), length_mm: z.number(), width_mm: z.number(), height_mm: z.number() })),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), unit_value_minor: z.number(), currency_code: z.string(), hs_code: z.string().nullish(), origin_country: z.string().nullish() })),
  pickup_instructions: z.string().nullable(),
  delivery_instructions: z.string().nullable(),
  invoice: z.object({ id: z.string(), number: z.string(), status: z.string(), kind: z.string(), total_minor: z.number(), refunded_minor: z.number(), refundable_minor: z.number().default(0) }).nullable(),
  pickups: z.array(z.object({ id: z.string(), status: z.string(), date: z.string(), scheduled_for: z.string().nullable() })),
  documents: z.array(z.object({ id: z.string(), type: z.string(), name: z.string(), size: z.number().default(0), generated: z.boolean(), event: z.string().nullish().transform((v) => v ?? null) })),
  compliance: z.object({
    status: z.string(), note: z.string().nullish().transform((v) => v ?? null), reviewed_at: z.string().nullish().transform((v) => v ?? null),
    findings: z.array(z.object({ index: z.number(), action: z.string(), label: z.string(), reason: z.string().nullish().transform((v) => v ?? null), matched: z.union([z.string(), z.array(z.string())]).nullish().transform((v) => v ?? null) })).default([]),
  }).default({ status: "clear", note: null, reviewed_at: null, findings: [] }),
  cancellable: z.boolean().default(false),
  cancellation_reason: z.string().nullish().transform((v) => v ?? null),
  notes: z.array(z.object({ id: z.number(), body: z.string(), created_at: z.string() })),
  tracking: staffTrackingSchema,
  is_demo: z.boolean(),
});
export type ShipmentDetail = z.infer<typeof shipmentDetailSchema>;

export type ShipmentFilters = { q?: string; stage?: string; country?: string; assigned_to?: string; sort?: string; dir?: string; page?: number };

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();

  return text ? `?${text}` : "";
}

export type ShipmentPage = Paged<ShipmentRow> & { searchLimited: string | null };

export async function fetchAdminShipments(filters: ShipmentFilters, signal?: AbortSignal): Promise<ShipmentPage> {
  const { body } = await apiRequest(`/admin/shipments${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(shipmentRowSchema), meta: z.object({ total: z.number(), last_page: z.number(), search_limited: z.string().nullable().optional() }) }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total, searchLimited: result.meta.search_limited ?? null };
}

export async function fetchAdminShipment(id: string, signal?: AbortSignal): Promise<ShipmentDetail> {
  return parse(z.object({ data: shipmentDetailSchema }), (await apiRequest(`/admin/shipments/${encodeURIComponent(id)}`, { signal })).body).data;
}

export async function fetchShipmentAssignees(signal?: AbortSignal): Promise<Assignee[]> {
  return parse(z.object({ data: z.array(assigneeSchema) }), (await apiRequest("/admin/shipments/assignees", { signal })).body).data;
}

export async function assignShipment(id: string, assignedTo: string | null): Promise<ShipmentRow> {
  return parse(z.object({ data: shipmentRowSchema }), (await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/assignment`, { method: "PATCH", body: { assigned_to: assignedTo } })).body).data;
}

export async function addShipmentNote(id: string, body: string): Promise<void> {
  await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/notes`, { method: "POST", body: { body } });
}

export type TrackingUpdate = {
  status: string;
  occurred_at?: string;
  description?: string;
  internal_note?: string;
  is_public: boolean;
  exception_code?: string;
  recipient_name?: string;
  location?: { city?: string; country?: string; facility?: string };
};

export async function addTrackingEvent(id: string, update: TrackingUpdate): Promise<StaffTracking> {
  return parse(z.object({ data: staffTrackingSchema }), (await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/tracking-events`, { method: "POST", body: update })).body).data;
}

/** Cancels before collection. A paid, prepaid booking is refunded in full first; if that refund fails the shipment stays booked. */
export async function cancelShipmentAsStaff(id: string, reason: string): Promise<void> {
  await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } });
}

/** Leave the amount out to refund everything still refundable. One key per attempt, so a retry cannot refund twice. */
export async function refundShipment(id: string, refund: { amount?: string; reason: string }, idempotencyKey: string): Promise<void> {
  await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/refund`, { method: "POST", body: refund, headers: { "Idempotency-Key": idempotencyKey } });
}

export async function uploadDeliveryProof(shipmentId: string, eventId: string, file: File): Promise<void> {
  const form = new FormData();
  form.set("file", file);
  await apiRequest(`/admin/shipments/${encodeURIComponent(shipmentId)}/tracking-events/${encodeURIComponent(eventId)}/proof`, { method: "POST", body: form });
}
