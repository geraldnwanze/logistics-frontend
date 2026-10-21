import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";
import { adminClaimSchema, adminClaimSummarySchema, adminTicketSchema, adminTicketSummarySchema, assigneeSchema, type AdminClaim, type AdminClaimSummary, type AdminTicket, type AdminTicketSummary, type Assignee } from "./schemas";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

const metaSchema = z.object({ total: z.number(), last_page: z.number() });
const linkSchema = z.object({ data: z.object({ url: z.string() }) });

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "" && value !== false) search.set(key, value === true ? "1" : String(value));   // Laravel's boolean rule reads 1/0, not "true"
  const text = search.toString();

  return text ? `?${text}` : "";
}

export type TicketFilters = { status?: string; priority?: string; category?: string; assigned_to?: string; breached?: boolean; q?: string; page?: number };

export async function fetchAdminTickets(filters: TicketFilters, signal?: AbortSignal): Promise<Paged<AdminTicketSummary>> {
  const { body } = await apiRequest(`/admin/tickets${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(adminTicketSummarySchema), meta: metaSchema }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

/** Colleagues a ticket can be handed to: an id and a name, nothing else. */
export async function fetchTicketAssignees(signal?: AbortSignal): Promise<Assignee[]> {
  return parse(z.object({ data: z.array(assigneeSchema) }), (await apiRequest("/admin/tickets/assignees", { signal })).body).data;
}

export async function fetchAdminTicket(id: string, signal?: AbortSignal): Promise<AdminTicket> {
  return parse(z.object({ data: adminTicketSchema }), (await apiRequest(`/admin/tickets/${encodeURIComponent(id)}`, { signal })).body).data;
}

/** JSON when there are no files; multipart when there are (booleans become "1"/"0", which is what the API's validator accepts). */
function withFiles(fields: Record<string, string | boolean | undefined>, files: File[]): Record<string, unknown> | FormData {
  if (files.length === 0) return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, typeof value === "boolean" ? (value ? "1" : "0") : value);
  for (const file of files) form.append("attachments[]", file);

  return form;
}

export type StaffReply = { message: string; internal: boolean; status?: "pending_customer" | "resolved" | "open" };

export async function replyToTicketAsStaff(id: string, reply: StaffReply, files: File[] = []): Promise<AdminTicket> {
  const body = withFiles({ message: reply.message, internal: reply.internal, ...(reply.status && !reply.internal ? { status: reply.status } : {}) }, files);

  return parse(z.object({ data: adminTicketSchema }), (await apiRequest(`/admin/tickets/${encodeURIComponent(id)}/messages`, { method: "POST", body })).body).data;
}

export type TicketChanges = { status?: string; priority?: string; category?: string; assigned_to?: string | null };

export async function updateTicket(id: string, changes: TicketChanges): Promise<AdminTicketSummary> {
  return parse(z.object({ data: adminTicketSummarySchema }), (await apiRequest(`/admin/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: changes })).body).data;
}

export async function fetchAdminTicketAttachmentLink(ticketId: string, attachmentId: string): Promise<{ url: string }> {
  return parse(linkSchema, (await apiRequest(`/admin/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`)).body).data;
}

export type ClaimFilters = { status?: string; type?: string; page?: number };

export async function fetchAdminClaims(filters: ClaimFilters, signal?: AbortSignal): Promise<Paged<AdminClaimSummary>> {
  const { body } = await apiRequest(`/admin/claims${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(adminClaimSummarySchema), meta: metaSchema }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function fetchAdminClaim(id: string, signal?: AbortSignal): Promise<AdminClaim> {
  return parse(z.object({ data: adminClaimSchema }), (await apiRequest(`/admin/claims/${encodeURIComponent(id)}`, { signal })).body).data;
}

export async function reviewClaim(id: string, status: "under_review" | "info_requested", note?: string): Promise<AdminClaim> {
  return parse(z.object({ data: adminClaimSchema }), (await apiRequest(`/admin/claims/${encodeURIComponent(id)}/review`, { method: "POST", body: { status, ...(note ? { note } : {}) } })).body).data;
}

export async function addClaimStaffNote(id: string, body: string, internal: boolean, files: File[] = []): Promise<AdminClaim> {
  return parse(z.object({ data: adminClaimSchema }), (await apiRequest(`/admin/claims/${encodeURIComponent(id)}/notes`, { method: "POST", body: withFiles({ body, internal }, files) })).body).data;
}

export type Decision = { decision: "approve"; approved_amount: string; note: string } | { decision: "reject"; note: string };

export async function decideClaim(id: string, decision: Decision): Promise<AdminClaim> {
  return parse(z.object({ data: adminClaimSchema }), (await apiRequest(`/admin/claims/${encodeURIComponent(id)}/decision`, { method: "POST", body: decision })).body).data;
}

/** One key per attempt of the same payout, so a double click or a retry after a dropped connection pays once. */
export async function payoutClaim(id: string, payout: { method: "refund" | "manual"; reference?: string }, idempotencyKey: string): Promise<AdminClaim> {
  return parse(z.object({ data: adminClaimSchema }), (await apiRequest(`/admin/claims/${encodeURIComponent(id)}/payout`, { method: "POST", body: payout, headers: { "Idempotency-Key": idempotencyKey } })).body).data;
}

export async function fetchAdminClaimAttachmentLink(claimId: string, attachmentId: string): Promise<{ url: string }> {
  return parse(linkSchema, (await apiRequest(`/admin/claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(attachmentId)}`)).body).data;
}
