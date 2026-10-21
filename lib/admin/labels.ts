import type { Tone } from "@/lib/shipping/format";

export const TICKET_STATUS_LABELS: Record<string, string> = { open: "Open", pending_staff: "Needs our reply", pending_customer: "Waiting for customer", resolved: "Resolved", closed: "Closed" };
export const PRIORITY_LABELS: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const CLAIM_STATUS_LABELS: Record<string, string> = { submitted: "New", under_review: "Under review", info_requested: "Waiting for customer", approved: "Approved, to pay", rejected: "Rejected", paid: "Paid", closed: "Closed", withdrawn: "Withdrawn" };

export function ticketTone(status: string): Tone {
  if (status === "pending_staff" || status === "open") return "warn";
  if (status === "resolved") return "good";

  return "plain";
}

export function claimTone(status: string): Tone {
  if (status === "submitted" || status === "approved") return "warn";
  if (status === "paid") return "good";
  if (status === "rejected") return "bad";

  return "plain";
}

export const priorityTone = (priority: string): Tone => (priority === "urgent" ? "bad" : priority === "high" ? "warn" : "plain");

export const can = (user: { permissions: string[] }, permission: string): boolean => user.permissions.includes(permission);

/** Claims can be read by whoever manages, decides or pays them. */
export const CLAIM_READERS = ["claims.manage", "claims.approve", "refunds.approve"];

export const canAny = (user: { permissions: string[] }, permissions: readonly string[]): boolean => permissions.some((permission) => can(user, permission));

/** Claims that still need staff attention or a next step. */
export const CLAIM_ACTIVE = ["submitted", "under_review", "info_requested", "approved"];
export const CLAIM_REVIEWABLE = ["submitted", "under_review", "info_requested"];
export const CLAIM_DECIDABLE = ["submitted", "under_review"];

export function dueIn(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(minutes);
  const span = abs >= 1440 ? `${Math.round(abs / 1440)} d` : abs >= 60 ? `${Math.round(abs / 60)} h` : `${abs} min`;

  return minutes < 0 ? `${span} overdue` : `due in ${span}`;
}

export const STAGES: { value: string; label: string }[] = [
  { value: "booking_pending", label: "Awaiting payment" }, { value: "awaiting_dispatch", label: "Awaiting dispatch" }, { value: "awaiting_pickup", label: "Awaiting pickup" },
  { value: "in_transit", label: "In transit" }, { value: "awaiting_customs", label: "With customs" }, { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" }, { value: "exceptions", label: "Exceptions" }, { value: "returned", label: "Returned" }, { value: "cancelled", label: "Cancelled" }, { value: "delayed", label: "Running late" },
];

export const EXCEPTION_REASONS: { value: string; label: string }[] = [
  { value: "address_issue", label: "Problem with the delivery address" }, { value: "recipient_unavailable", label: "Recipient not available" }, { value: "recipient_refused", label: "Recipient refused it" },
  { value: "damaged", label: "Shipment damaged" }, { value: "customs_delay", label: "Delayed by customs" }, { value: "weather", label: "Delayed by weather" }, { value: "other", label: "Something else" },
];

export const EVENT_SOURCE_LABELS: Record<string, string> = { staff: "Staff", system: "System", carrier: "Carrier", simulated: "Simulated" };

export const INVOICE_STATUS_LABELS: Record<string, string> = { issued: "Unpaid", paid: "Paid", void: "Cancelled", partially_refunded: "Partly refunded", refunded: "Refunded" };
export const INVOICE_KIND_LABELS: Record<string, string> = { prepaid: "Paid online", invoiced: "On account" };
export const ATTEMPT_STATUS_LABELS: Record<string, string> = { creating: "Starting", requires_action: "Needs the customer", processing: "Processing", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" };
export const LEDGER_TYPE_LABELS: Record<string, string> = { charge: "Payment received", refund: "Refund paid out" };

export function invoiceTone(status: string, overdue: boolean): Tone {
  if (overdue) return "bad";
  if (status === "paid") return "good";
  if (status === "issued") return "warn";

  return "plain";
}

export function attemptTone(status: string): Tone {
  if (status === "succeeded") return "good";
  if (status === "failed") return "bad";
  if (["creating", "requires_action", "processing"].includes(status)) return "warn";

  return "plain";
}

export const RECONCILIATION_TITLES: Record<string, string> = {
  paid_invoice_without_matching_charges: "Paid invoices that don't match their charges",
  succeeded_attempt_without_ledger_entry: "Successful payments missing from the ledger",
  duplicate_payments_to_refund: "Duplicate payments to refund",
  refund_credit_note_mismatch: "Refunds that don't match credit notes",
  stuck_payment_attempts: "Payments that never finished",
  failed_webhooks: "Webhooks that failed",
  overdue_invoices: "Overdue invoices on account",
};

export const COMPLIANCE_STATUS_LABELS: Record<string, string> = { clear: "Clear", review_required: "Waiting for review", approved: "Approved", rejected: "Rejected" };
export const FINDING_ACTION_LABELS: Record<string, string> = { restricted: "Restricted", prohibited: "Prohibited" };
export const CHARGE_TYPE_LABELS: Record<string, string> = { duty: "Duty", tax: "Tax", fee: "Fee", storage: "Storage" };
export const CHARGE_STATUS_LABELS: Record<string, string> = { assessed: "To be paid", paid: "Paid", waived: "Waived" };
export const PAYER_LABELS: Record<string, string> = { sender: "The sender", recipient: "The recipient", company: "Our company" };

export function complianceTone(status: string): Tone {
  if (status === "review_required") return "warn";
  if (status === "rejected") return "bad";
  if (status === "approved") return "good";

  return "plain";
}

export const APPLIES_TO_LABELS: Record<string, string> = { any: "Origin or destination", origin: "Sending from", destination: "Sending to" };
export const SHIPMENT_TYPE_LABELS: Record<string, string> = { parcel: "Parcels", document: "Documents", freight: "Freight" };
export const DIRECTION_LABELS: Record<string, string> = { export: "Leaving the country", import: "Arriving in the country" };

export const STAFF_STATUS_LABELS: Record<string, string> = { active: "Active", suspended: "Suspended" };
