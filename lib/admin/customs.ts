import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";
import { shipmentRowSchema } from "./shipments";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

export const findingSchema = z.object({ index: z.number(), action: z.string(), label: z.string(), reason: z.string().nullish().transform((v) => v ?? null), matched: z.union([z.string(), z.array(z.string())]).nullish().transform((v) => v ?? null) });
export type Finding = z.infer<typeof findingSchema>;

export const complianceRowSchema = shipmentRowSchema.extend({ findings: z.array(findingSchema).default([]) });
export type ComplianceRow = z.infer<typeof complianceRowSchema>;

export async function fetchComplianceQueue(page: number, signal?: AbortSignal): Promise<Paged<ComplianceRow>> {
  const { body } = await apiRequest(`/admin/compliance/queue${page > 1 ? `?page=${page}` : ""}`, { signal });
  const result = parse(z.object({ data: z.array(complianceRowSchema), meta: z.object({ total: z.number(), last_page: z.number() }) }), body);

  return { items: result.data, page, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function reviewCompliance(id: string, decision: "approve" | "reject", note: string): Promise<{ status: string; compliance_status: string }> {
  return parse(z.object({ data: z.object({ status: z.string(), compliance_status: z.string() }) }), (await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/compliance`, { method: "POST", body: { decision, note } })).body).data;
}

const requirement = z.object({ id: z.number(), direction: z.enum(["export", "import"]), document_type: z.string(), label: z.string(), mandatory: z.boolean(), notes: z.string().nullable(), status: z.enum(["satisfied", "missing"]), reason: z.string().nullable() });
const charge = z.object({ id: z.string(), type: z.string(), description: z.string(), amount_minor: z.number(), currency: z.string(), assessed_by: z.string().nullable(), authority_reference: z.string().nullable(), status: z.string(), paid_at: z.string().nullable() });

export const customsOverviewSchema = z.object({
  international: z.boolean(),
  declaration: z.object({ incoterm: z.string().nullable(), reason_for_export: z.string().nullable(), exporter_tax_id: z.string().nullable(), consignee_tax_id: z.string().nullable(), eori_number: z.string().nullable(), remarks: z.string().nullable() }).nullable(),
  requirements: z.array(requirement),
  ready_for_export: z.boolean(),
  estimates: z.object({ note: z.string(), items: z.array(z.object({ label: z.string(), amount_minor: z.number(), currency: z.string() })) }),
  assessed_charges: z.object({ note: z.string(), items: z.array(charge) }),
});
export type CustomsOverview = z.infer<typeof customsOverviewSchema>;
export type Charge = z.infer<typeof charge>;

export async function fetchCustomsOverview(id: string, signal?: AbortSignal): Promise<CustomsOverview> {
  return parse(z.object({ data: customsOverviewSchema }), (await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/customs`, { signal })).body).data;
}

export type NewCharge = { type: string; description: string; amount: string; currency: string; assessed_by: string; authority_reference?: string };

export async function recordCustomsCharge(id: string, charge: NewCharge): Promise<void> {
  await apiRequest(`/admin/shipments/${encodeURIComponent(id)}/customs-charges`, { method: "POST", body: charge });
}

export async function payCustomsCharge(chargeId: string, payer: string, reference: string): Promise<void> {
  await apiRequest(`/admin/customs-charges/${encodeURIComponent(chargeId)}/payment`, { method: "POST", body: { payer, reference } });
}

export async function waiveCustomsCharge(chargeId: string): Promise<void> {
  await apiRequest(`/admin/customs-charges/${encodeURIComponent(chargeId)}/waive`, { method: "POST" });
}
