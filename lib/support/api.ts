import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import { guestTokenFor } from "@/lib/shipping/guest";
import type { Paged } from "@/lib/shipping/schemas";
import { claimShipmentFor, ticketTokenFor } from "./tokens";
import { claimLimitsSchema, claimSchema, ticketSchema, ticketSummarySchema, type Claim, type ClaimLimits, type ClaimType, type Ticket, type TicketSummary } from "./schemas";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

const ticketHeaders = (ticketId: string): Record<string, string> => {
  const token = ticketTokenFor(ticketId);

  return token ? { "X-Ticket-Token": token } : {};
};

const shipmentHeaders = (shipmentId: string): Record<string, string> => {
  const token = guestTokenFor(shipmentId);

  return token ? { "X-Guest-Token": token } : {};
};

/** JSON when there are no files; multipart when there are, so the same endpoints serve both. */
function withFiles(fields: Record<string, string | undefined>, files: File[]): Record<string, unknown> | FormData {
  if (files.length === 0) return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
  for (const file of files) form.append("attachments[]", file);

  return form;
}

export type NewTicket = { subject: string; category: string; message: string; tracking_number?: string; email?: string };

/** `shipmentId` lets a guest prove the tracking number is theirs, using the access token this tab holds for that shipment. */
export async function openTicket(input: NewTicket, shipmentId?: string, files: File[] = []): Promise<Ticket> {
  return parse(z.object({ data: ticketSchema }), (await apiRequest("/support/tickets", { method: "POST", body: withFiles(input, files), headers: shipmentId ? shipmentHeaders(shipmentId) : {} })).body).data;
}

export async function fetchTicket(id: string, signal?: AbortSignal): Promise<Ticket> {
  return parse(z.object({ data: ticketSchema }), (await apiRequest(`/support/tickets/${encodeURIComponent(id)}`, { signal, headers: ticketHeaders(id) })).body).data;
}

export async function replyToTicket(id: string, message: string, files: File[] = []): Promise<Ticket> {
  return parse(z.object({ data: ticketSchema }), (await apiRequest(`/support/tickets/${encodeURIComponent(id)}/messages`, { method: "POST", body: withFiles({ message }, files), headers: ticketHeaders(id) })).body).data;
}

export async function fetchTicketAttachmentLink(ticketId: string, attachmentId: string): Promise<{ url: string }> {
  return parse(z.object({ data: z.object({ url: z.string() }) }), (await apiRequest(`/support/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: ticketHeaders(ticketId) })).body).data;
}

export async function closeTicket(id: string): Promise<TicketSummary> {
  return parse(z.object({ data: ticketSummarySchema }), (await apiRequest(`/support/tickets/${encodeURIComponent(id)}/close`, { method: "POST", headers: ticketHeaders(id) })).body).data;
}

export async function fetchTickets(page: number, signal?: AbortSignal): Promise<Paged<TicketSummary>> {
  const { body } = await apiRequest(`/support/tickets${page > 1 ? `?page=${page}` : ""}`, { signal });
  const result = parse(z.object({ data: z.array(ticketSummarySchema), meta: z.object({ total: z.number(), last_page: z.number() }) }), body);

  return { items: result.data, page, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function fetchClaimLimits(shipmentId: string, signal?: AbortSignal): Promise<ClaimLimits> {
  return parse(z.object({ data: claimLimitsSchema }), (await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/claim-limits`, { signal, headers: shipmentHeaders(shipmentId) })).body).data;
}

export type NewClaim = { type: ClaimType; claimed_amount: string; description: string; incident_date: string; email?: string };

export async function fileClaim(shipmentId: string, input: NewClaim, files: File[] = []): Promise<Claim> {
  return parse(z.object({ data: claimSchema }), (await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/claims`, { method: "POST", body: withFiles(input, files), headers: shipmentHeaders(shipmentId) })).body).data;
}

/** A claim is reached by its owner's session, or, for a guest, through the token of the shipment it was filed on. */
function claimHeaders(claimId: string): Record<string, string> {
  const shipmentId = claimShipmentFor(claimId);

  return shipmentId ? shipmentHeaders(shipmentId) : {};
}

export async function withdrawClaim(id: string): Promise<Claim> {
  return parse(z.object({ data: claimSchema }), (await apiRequest(`/claims/${encodeURIComponent(id)}/withdraw`, { method: "POST", headers: claimHeaders(id) })).body).data;
}

export async function fetchClaim(id: string, signal?: AbortSignal): Promise<Claim> {
  return parse(z.object({ data: claimSchema }), (await apiRequest(`/claims/${encodeURIComponent(id)}`, { signal, headers: claimHeaders(id) })).body).data;
}

export async function addClaimNote(id: string, body: string, files: File[] = []): Promise<Claim> {
  return parse(z.object({ data: claimSchema }), (await apiRequest(`/claims/${encodeURIComponent(id)}/notes`, { method: "POST", body: withFiles({ body }, files), headers: claimHeaders(id) })).body).data;
}

export async function fetchClaimAttachmentLink(claimId: string, attachmentId: string): Promise<{ url: string }> {
  return parse(z.object({ data: z.object({ url: z.string() }) }), (await apiRequest(`/claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: claimHeaders(claimId) })).body).data;
}

export async function fetchClaims(page: number, signal?: AbortSignal): Promise<Paged<Claim>> {
  const { body } = await apiRequest(`/claims${page > 1 ? `?page=${page}` : ""}`, { signal });
  const result = parse(z.object({ data: z.array(claimSchema), meta: z.object({ total: z.number(), last_page: z.number() }) }), body);

  return { items: result.data, page, lastPage: result.meta.last_page, total: result.meta.total };
}
