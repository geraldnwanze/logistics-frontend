import type { Claim, ClaimLimits, Ticket } from "@/lib/support/schemas";
import { money } from "./shipping-fixtures";

export function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "T1", number: "TKT-2026-000001", subject: "Where is my parcel?", category: "shipment", status: "open", last_activity_at: "2026-10-16T09:00:00Z", tracking_number: "LG000000000001",
    messages: [{ from: "customer", body: "It has not moved for three days.", created_at: "2026-10-16T09:00:00Z", attachments: [] }], ...over,
  };
}

export function claim(over: Partial<Claim> = {}): Claim {
  return {
    id: "C1", number: "CLM-2026-000001", status: "submitted", type: "damage", tracking_number: "LG000000000001", description: "The box arrived crushed.", incident_date: "2026-10-15",
    claimed: money(2000), approved: null, paid: null, resolution_note: null, notes: [], attachments: [], created_at: "2026-10-16T09:00:00Z", ...over,
  };
}

export function limits(over: Partial<ClaimLimits> = {}): ClaimLimits {
  return {
    currency: "USD", insured: false, cap: money(7041), decimals: 2, window_days: 30,
    eligibility: {
      loss: { eligible: false, reason: "A delivered shipment cannot be claimed as lost." }, damage: { eligible: true, reason: null },
      delay: { eligible: false, reason: "This shipment was delivered on time." }, other: { eligible: true, reason: null },
    }, ...over,
  };
}
