import type { Tone } from "@/lib/shipping/format";

export const CATEGORY_LABELS: Record<string, string> = { general: "General question", shipment: "A shipment", billing: "Billing and payments", customs: "Customs and documents", technical: "Problem with the website" };

export function ticketStatus(status: string): { text: string; tone: Tone } {
  switch (status) {
    case "open": return { text: "Open", tone: "plain" };
    case "pending_staff": return { text: "Waiting for our team", tone: "plain" };
    case "pending_customer": return { text: "Waiting for your reply", tone: "warn" };
    case "resolved": return { text: "Resolved", tone: "good" };
    case "closed": return { text: "Closed", tone: "plain" };
    default: return { text: status.replace(/_/g, " "), tone: "plain" };
  }
}

export const CLAIM_TYPE_LABELS: Record<string, string> = { loss: "Lost shipment", damage: "Damaged goods", delay: "Late delivery", other: "Something else" };

export function claimStatus(status: string): { text: string; tone: Tone; explain: string } {
  switch (status) {
    case "submitted": return { text: "Received", tone: "plain", explain: "We've received your claim and will review it." };
    case "under_review": return { text: "Under review", tone: "plain", explain: "Our team is looking at your claim." };
    case "info_requested": return { text: "We need more information", tone: "warn", explain: "Please read our message below and reply with what we've asked for." };
    case "approved": return { text: "Approved", tone: "good", explain: "Your claim was approved. Payment is being arranged." };
    case "rejected": return { text: "Not approved", tone: "bad", explain: "We weren't able to approve this claim." };
    case "paid": return { text: "Paid", tone: "good", explain: "Compensation has been paid." };
    case "closed": return { text: "Closed", tone: "plain", explain: "This claim is closed." };
    case "withdrawn": return { text: "Withdrawn", tone: "plain", explain: "You withdrew this claim. If you still need help, you can file a new one." };
    default: return { text: status.replace(/_/g, " "), tone: "plain", explain: "" };
  }
}

export const CLAIM_FINISHED = ["paid", "rejected", "closed", "withdrawn"];

/** Until a decision is made, the customer can still take a claim back. */
export const CLAIM_WITHDRAWABLE = ["submitted", "under_review", "info_requested"];
