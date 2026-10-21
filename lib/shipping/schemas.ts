import { z } from "zod";

export const countrySchema = z.object({
  code: z.string(),
  name: z.string(),
  dial_code: z.string().nullable(),
  currency_code: z.string().nullable(),
  postal_code_required: z.boolean(),
  postal_code_pattern: z.string().nullable(),
  state_required: z.boolean(),
  state_label: z.string().nullable(),
});
export type Country = z.infer<typeof countrySchema>;

export const moneySchema = z.object({ amount_minor: z.number(), amount: z.string(), currency: z.string() });
export type Money = z.infer<typeof moneySchema>;

const place = z.object({ country: z.string(), city: z.string(), postal: z.string().nullish() });

export const quoteOptionSchema = z.object({
  id: z.string(),
  service: z.object({ slug: z.string(), name: z.string(), category: z.string().nullish(), is_demo: z.boolean() }),
  estimated_delivery: z.object({ min_days: z.number(), max_days: z.number() }),
  weights: z.object({ actual_g: z.number(), volumetric_g: z.number(), billable_g: z.number(), volumetric_divisor: z.number() }),
  line_items: z.array(z.object({ kind: z.string(), code: z.string(), label: z.string(), is_estimate: z.boolean(), amount: moneySchema })),
  totals: z.object({ charges: moneySchema, tax: moneySchema, insurance: moneySchema, total: moneySchema, estimated_duties_and_import_taxes: moneySchema }),
  exchange_rate: z.object({ from: z.string(), to: z.string(), rate: z.union([z.string(), z.number()]), effective_at: z.string().nullish(), source: z.string().nullish() }).nullable(),
  restrictions: z.array(z.string()),
  required_documents: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type QuoteOption = z.infer<typeof quoteOptionSchema>;

export const quoteSchema = z.object({
  id: z.string(),
  status: z.string(),
  currency: z.string(),
  expires_at: z.string(),
  accepted_option_id: z.string().nullable(),
  shipment: z.object({ origin: place, destination: place, shipment_type: z.string(), contents: z.string(), package_count: z.number(), declared_value: moneySchema.nullish() }),
  options: z.array(quoteOptionSchema).default([]),
  unavailable: z.array(z.object({ service: z.string(), name: z.string(), reasons: z.array(z.string()) })).default([]),
});
export type Quote = z.infer<typeof quoteSchema>;

const party = z.object({
  name: z.string(), company: z.string().nullable(), phone: z.string(), email: z.string().nullable(), line1: z.string(), line2: z.string().nullable(),
  city: z.string(), state: z.string().nullable(), postal_code: z.string().nullable(), country: z.string(),
});

export const shipmentSchema = z.object({
  id: z.string(),
  tracking_number: z.string(),
  status: z.string(),
  status_label: z.string(),
  is_demo: z.boolean(),
  service: z.object({ slug: z.string(), name: z.string() }),
  estimated_delivery: z.object({ min_days: z.number(), max_days: z.number() }),
  total: moneySchema,
  payment: z.object({
    method: z.string().nullable(), status: z.string().nullable(), invoice_id: z.string().nullable(), invoice_number: z.string().nullable(), requires_payment: z.boolean(),
    refunded: moneySchema.nullish(),
  }),
  sender: party.nullable(),
  recipient: party.nullable(),
  contents: z.string(),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), unit_value_minor: z.number(), currency: z.string(), hs_code: z.string().nullable(), origin_country: z.string() })),
  required_documents: z.array(z.string()).default([]),
  documents: z.array(z.object({ id: z.string(), type: z.string(), name: z.string(), size: z.number(), generated: z.boolean().default(false), removable: z.boolean().default(false), uploaded_at: z.string() })).default([]),
  cancellable: z.boolean().default(false),
  cancellation_reason: z.string().nullish(),
  cancelled_at: z.string().nullish(),
  created_at: z.string(),
  guest_access_token: z.string().optional(),
});
export type Shipment = z.infer<typeof shipmentSchema>;

export const paymentStartSchema = z.object({
  id: z.string(),
  status: z.string(),
  action: z.object({ type: z.string(), url: z.string(), sandbox: z.boolean().optional() }).nullable(),
});

export const invoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  kind: z.string(),
  shipment_id: z.string().nullable(),
  tracking_number: z.string().nullable(),
  subtotal: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  refunded: moneySchema,
  billing_name: z.string().nullable(),
  issued_at: z.string(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  items: z.array(z.object({ kind: z.string(), description: z.string(), amount: moneySchema })),
  credit_notes: z.array(z.object({ number: z.string(), amount: moneySchema, issued_at: z.string() })),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const pageMetaSchema = z.object({ current_page: z.number(), last_page: z.number(), total: z.number(), per_page: z.number() });
export type Paged<T> = { items: T[]; page: number; lastPage: number; total: number };

const customsMoney = z.object({ amount_minor: z.number(), currency: z.string() });

export const customsSchema = z.object({
  international: z.boolean(),
  declaration: z.object({
    incoterm: z.string(), reason_for_export: z.string(), exporter_tax_id: z.string().nullable(), consignee_tax_id: z.string().nullable(), eori_number: z.string().nullable(), remarks: z.string().nullable(),
  }).nullable(),
  requirements: z.array(z.object({
    id: z.number(), direction: z.enum(["export", "import"]), document_type: z.string(), label: z.string(), mandatory: z.boolean(), notes: z.string().nullable(), status: z.enum(["satisfied", "missing"]), reason: z.string().nullable(),
  })),
  ready_for_export: z.boolean(),
  compliance: z.object({ status: z.string().nullable(), note: z.string().nullable() }),
  estimates: z.object({ note: z.string(), items: z.array(customsMoney.extend({ label: z.string() })) }),
  assessed_charges: z.object({
    note: z.string(),
    items: z.array(customsMoney.extend({ id: z.string(), type: z.string(), description: z.string(), assessed_by: z.string(), authority_reference: z.string().nullable(), status: z.string(), paid_at: z.string().nullable() })),
  }),
});
export type Customs = z.infer<typeof customsSchema>;
export type Declaration = NonNullable<Customs["declaration"]>;
