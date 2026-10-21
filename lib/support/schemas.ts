import { z } from "zod";
import { moneySchema } from "@/lib/shipping/schemas";

export const TICKET_CATEGORIES = ["general", "shipment", "billing", "customs", "technical"] as const;
export const CLAIM_TYPES = ["loss", "damage", "delay", "other"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const attachmentSchema = z.object({ id: z.string(), name: z.string(), size: z.number(), type: z.string() });
export type Attachment = z.infer<typeof attachmentSchema>;

export const ticketSummarySchema = z.object({ id: z.string(), number: z.string(), subject: z.string(), category: z.string(), status: z.string(), last_activity_at: z.string() });

export const ticketSchema = ticketSummarySchema.extend({
  tracking_number: z.string().nullish(),
  messages: z.array(z.object({ from: z.string(), body: z.string(), created_at: z.string(), attachments: z.array(attachmentSchema).default([]) })),
  access_token: z.string().optional(),
});
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

const note = z.object({ from: z.string(), body: z.string(), created_at: z.string(), attachments: z.array(attachmentSchema).default([]) });

export const claimSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  type: z.string(),
  tracking_number: z.string(),
  description: z.string(),
  incident_date: z.string(),
  claimed: moneySchema,
  approved: moneySchema.nullable(),
  paid: moneySchema.nullable(),
  resolution_note: z.string().nullable(),
  notes: z.array(note).nullable(),
  attachments: z.array(attachmentSchema).default([]),
  created_at: z.string(),
});
export type Claim = z.infer<typeof claimSchema>;

export const claimLimitsSchema = z.object({
  currency: z.string(),
  insured: z.boolean(),
  cap: moneySchema,
  decimals: z.number(),
  window_days: z.number(),
  eligibility: z.record(z.string(), z.object({ eligible: z.boolean(), reason: z.string().nullable() })),
});
export type ClaimLimits = z.infer<typeof claimLimitsSchema>;
