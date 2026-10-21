import type { AdminClaim, AdminClaimSummary, AdminTicket, AdminTicketSummary } from "@/lib/admin/schemas";
import type { User } from "@/lib/auth/schemas";
import { money } from "./shipping-fixtures";

export const staff = (permissions: string[], over: Partial<User> = {}): User => ({
  id: "01STAFF", name: "Sam Staff", email: "sam@example.test", email_verified: true, roles: ["customer-support-agent"], permissions, two_factor_enabled: true, ...over,
});

export const AGENT = ["tickets.manage", "claims.manage"];
export const APPROVER = [...AGENT, "claims.approve"];
export const FINANCE = ["claims.approve", "refunds.approve"];

export function ticketRow(over: Partial<AdminTicketSummary> = {}): AdminTicketSummary {
  return {
    id: "T1", number: "TKT-2026-000001", subject: "Where is my parcel?", category: "shipment", priority: "normal", status: "pending_staff", requester: { id: "01ADA", name: "Ada Shipper", email: "ada@example.test" },
    tracking_number: "LG000000000001", assigned_to: null, assignee: null, first_response_due_at: "2026-10-16T12:00:00Z", first_response_at: null, sla_breached: false,
    last_activity_at: "2026-10-16T09:00:00Z", created_at: "2026-10-16T09:00:00Z", ...over,
  };
}

export function adminTicket(over: Partial<AdminTicket> = {}): AdminTicket {
  return {
    ...ticketRow(),
    messages: [{ id: 1, from: "customer", internal: false, body: "It has not moved for three days.", author: null, created_at: "2026-10-16T09:00:00Z", attachments: [] }],
    ...over,
  };
}

export function claimRow(over: Partial<AdminClaimSummary> = {}): AdminClaimSummary {
  return { id: "C1", number: "CLM-2026-000001", status: "submitted", type: "damage", tracking_number: "LG000000000001", claimed: money(2000), approved: null, paid: null, created_at: "2026-10-16T09:00:00Z", ...over };
}

export function adminClaim(over: Partial<AdminClaim> = {}): AdminClaim {
  return {
    ...claimRow(), description: "The box arrived crushed.", incident_date: "2026-10-15", resolution_note: null, decided_at: null, insured: false, attachments: [], notes: [],
    limits: { currency: "USD", cap_minor: 7041, insured: false }, ...over,
  };
}

import type { ShipmentDetail, ShipmentRow } from "@/lib/admin/shipments";

export const OPS = ["shipments.view", "shipments.update", "shipments.assign", "tracking.create", "customers.view"];

export function shipmentRow(over: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id: "S1", tracking_number: "LG000000000001", status: { code: "in_transit", label: "In transit" }, service: "International Economy",
    created_at: "2026-10-10T08:00:00Z", status_changed_at: "2026-10-14T08:00:00Z", origin: { city: "Lagos", country: "NG" }, destination: { city: "Berlin", country: "DE" },
    total: money(7041), payment_status: "paid", assigned_to: null, assignee: null, facility: null, delayed: false, compliance_status: "clear", customer: { name: "Ada Shipper", email: "ada@example.test" }, ...over,
  };
}

export function shipmentDetail(over: Partial<ShipmentDetail> = {}): ShipmentDetail {
  return {
    ...shipmentRow(),
    sender: { name: "Ife Okoro", company: null, phone: "+2348012345678", email: "ife@example.test", line1: "1 Marina Road", line2: null, city: "Lagos", state: "Lagos", postal_code: "100001", country: "NG" },
    recipient: { name: "Hans Becker", company: null, phone: "+4915112345678", email: null, line1: "2 Unter den Linden", line2: null, city: "Berlin", state: null, postal_code: "10115", country: "DE" },
    contents: "Books", declared_value: { amount_minor: 10000, currency: "USD" }, insurance_requested: false, billable_weight_g: 2000,
    packages: [{ type: "box", weight_g: 2000, length_mm: 300, width_mm: 200, height_mm: 100 }], items: [], pickup_instructions: null, delivery_instructions: null,
    invoice: { id: "I1", number: "INV-2026-000001", status: "paid", kind: "prepaid", total_minor: 7041, refunded_minor: 0, refundable_minor: 7041 }, pickups: [], documents: [], notes: [], compliance: { status: "clear", note: null, reviewed_at: null, findings: [] }, cancellable: false, cancellation_reason: null,
    tracking: {
      tracking_number: "LG000000000001", status: { code: "in_transit", label: "In transit" }, international: true,
      allowed_next: [{ code: "arrived_destination_country", label: "Arrived in destination country" }, { code: "exception", label: "Exception" }, { code: "delivered", label: "Delivered" }],
      events: [
        { id: "E1", status: { code: "picked_up", label: "Picked up" }, description: "Collected from sender", occurred_at: "2026-10-13T08:00:00Z", timezone: "UTC", location: { city: "Lagos", country: "NG", facility: null }, source: "staff", reason: null, internal_note: "Driver: Tunde", is_public: true, applied: true, rejection_reason: null, recipient_name: null },
        { id: "E2", status: { code: "in_transit", label: "In transit" }, description: null, occurred_at: "2026-10-14T08:00:00Z", timezone: "UTC", location: { city: null, country: null, facility: null }, source: "carrier", reason: null, internal_note: null, is_public: true, applied: true, rejection_reason: null, recipient_name: null },
        { id: "E3", status: { code: "delivered", label: "Delivered" }, description: null, occurred_at: "2026-10-14T09:00:00Z", timezone: "UTC", location: { city: null, country: null, facility: null }, source: "carrier", reason: null, internal_note: null, is_public: true, applied: false, rejection_reason: "Out of order: arrived before it left.", recipient_name: null },
      ],
    },
    is_demo: true, ...over,
  };
}
