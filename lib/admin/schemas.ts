import { z } from "zod";
import { moneySchema } from "@/lib/shipping/schemas";
import { attachmentSchema } from "@/lib/support/schemas";

export const TICKET_STATUSES = ["open", "pending_staff", "pending_customer", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const CLAIM_STATUSES = ["submitted", "under_review", "info_requested", "approved", "rejected", "paid", "closed", "withdrawn"] as const;

const requesterSchema = z.object({ id: z.string().optional(), name: z.string().optional(), email: z.string().nullish() });

export const adminTicketSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  subject: z.string(),
  category: z.string(),
  priority: z.string(),
  status: z.string(),
  requester: requesterSchema,
  tracking_number: z.string().nullable(),
  assigned_to: z.string().nullable(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullish().transform((v) => v ?? null),
  first_response_due_at: z.string().nullable(),
  first_response_at: z.string().nullable(),
  sla_breached: z.boolean(),
  last_activity_at: z.string(),
  created_at: z.string(),
});

export const adminTicketSchema = adminTicketSummarySchema.extend({
  messages: z.array(z.object({ id: z.number(), from: z.string(), internal: z.boolean(), body: z.string(), author: z.string().nullable(), created_at: z.string(), attachments: z.array(attachmentSchema).default([]) })),
});

export const adminClaimSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  type: z.string(),
  tracking_number: z.string(),
  claimed: moneySchema,
  approved: moneySchema.nullable(),
  paid: moneySchema.nullable(),
  created_at: z.string(),
});

export const adminClaimSchema = adminClaimSummarySchema.extend({
  description: z.string(),
  incident_date: z.string(),
  resolution_note: z.string().nullable(),
  decided_at: z.string().nullable(),
  insured: z.boolean(),
  attachments: z.array(attachmentSchema).default([]),
  notes: z.array(z.object({ from: z.string(), internal: z.boolean(), body: z.string(), created_at: z.string(), attachments: z.array(attachmentSchema).default([]) })).nullable(),
  limits: z.object({ currency: z.string(), cap_minor: z.number(), insured: z.boolean() }).optional(),
});

export const assigneeSchema = z.object({ id: z.string(), name: z.string() });
export type Assignee = z.infer<typeof assigneeSchema>;
export type AdminTicketSummary = z.infer<typeof adminTicketSummarySchema>;
export type AdminTicket = z.infer<typeof adminTicketSchema>;
export type AdminClaimSummary = z.infer<typeof adminClaimSummarySchema>;
export type AdminClaim = z.infer<typeof adminClaimSchema>;
