import { z } from "zod";
import { API_ORIGIN, ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

/** How many decimal places a currency has, from the browser's own currency data (JPY 0, USD 2, KWD 3). */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Money in minor units, as finance sees it in ledgers and reconciliation rows. */
export function formatMinorAmount(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const text = Math.abs(minor).toString().padStart(decimals + 1, "0");
  const amount = decimals === 0 ? text : `${text.slice(0, -decimals)}.${text.slice(-decimals)}`;

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: decimals }).format(Number(minor < 0 ? `-${amount}` : amount));
  } catch {
    return `${minor < 0 ? "-" : ""}${amount} ${currency}`;
  }
}

export const invoiceRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  kind: z.string(),
  tracking_number: z.string().nullable(),
  shipment_id: z.string().nullish().transform((v) => v ?? null),
  billing_name: z.string().nullable(),
  currency: z.string(),
  total_minor: z.number(),
  refunded_minor: z.number(),
  issued_at: z.string(),
  due_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  overdue: z.boolean(),
});
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;

const attempt = z.object({ id: z.string(), provider: z.string(), reference: z.string().nullable(), status: z.string(), failure_code: z.string().nullable(), amount_minor: z.number(), duplicate: z.boolean() });

export const invoiceDetailSchema = invoiceRowSchema.extend({
  items: z.array(z.object({ kind: z.string(), description: z.string(), amount_minor: z.number() })),
  payment_attempts: z.array(attempt),
  ledger: z.array(z.object({ type: z.string(), amount_minor: z.number(), reference: z.string().nullable(), metadata: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable(), occurred_at: z.string() })),
  credit_notes: z.array(z.object({ number: z.string(), amount_minor: z.number() })),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const paymentRowSchema = z.object({
  id: z.string(),
  invoice: z.string(),
  provider: z.string(),
  reference: z.string().nullable(),
  status: z.string(),
  failure_code: z.string().nullable(),
  amount_minor: z.number(),
  currency: z.string(),
  duplicate: z.boolean(),
  created_at: z.string(),
});
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const reconciliationSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  summary: z.record(z.string(), z.number()),
  checks: z.record(z.string(), z.object({ description: z.string(), count: z.number(), rows: z.array(z.record(z.string(), z.unknown())) })),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "" && value !== false) search.set(key, value === true ? "1" : String(value));   // Laravel's boolean rule reads 1/0, not "true"
  const text = search.toString();

  return text ? `?${text}` : "";
}

const meta = z.object({ total: z.number(), last_page: z.number().default(1) });

export type InvoiceFilters = { status?: string; kind?: string; overdue?: boolean; q?: string; from?: string; to?: string; page?: number };

export async function fetchInvoices(filters: InvoiceFilters, signal?: AbortSignal): Promise<Paged<InvoiceRow>> {
  const { body } = await apiRequest(`/admin/finance/invoices${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(invoiceRowSchema), meta }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function fetchInvoice(id: string, signal?: AbortSignal): Promise<InvoiceDetail> {
  return parse(z.object({ data: invoiceDetailSchema }), (await apiRequest(`/admin/finance/invoices/${encodeURIComponent(id)}`, { signal })).body).data;
}

/** Money received outside the gateway for an invoice on account. One key per attempt, so a retry cannot record it twice. */
export async function recordOfflinePayment(id: string, reference: string, idempotencyKey: string): Promise<InvoiceRow> {
  return parse(z.object({ data: invoiceRowSchema }), (await apiRequest(`/admin/finance/invoices/${encodeURIComponent(id)}/payments`, { method: "POST", body: { reference }, headers: { "Idempotency-Key": idempotencyKey } })).body).data;
}

export type PaymentFilters = { status?: string; provider?: string; page?: number };

export async function fetchPayments(filters: PaymentFilters, signal?: AbortSignal): Promise<Paged<PaymentRow>> {
  const { body } = await apiRequest(`/admin/finance/payments${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(paymentRowSchema), meta }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function fetchReconciliation(range: { from?: string; to?: string }, signal?: AbortSignal): Promise<Reconciliation> {
  return parse(z.object({ data: reconciliationSchema }), (await apiRequest(`/admin/finance/reconciliation${query(range)}`, { signal })).body).data;
}

/**
 * The ledger as a CSV file. The API streams it with the session cookie, so it is fetched and saved from here;
 * a refusal (too many rows, no permission) arrives as the usual JSON error and is shown as text.
 */
export async function downloadLedger(from: string, to: string, save: (blob: Blob, filename: string) => void = saveBlob): Promise<void> {
  let response: Response;

  try {
    response = await fetch(`${API_ORIGIN}/api/v1/admin/finance/export/transactions${query({ from, to })}`, { credentials: "include", headers: { Accept: "text/csv, application/json" } });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const parsed = await response.json().catch(() => null);
    const message = typeof parsed?.error?.message === "string" ? parsed.error.message : "The export could not be prepared.";

    throw new ApiError(response.status, typeof parsed?.error?.code === "string" ? parsed.error.code : "export_failed", message);
  }

  save(await response.blob(), `ledger-${from}_${to}.csv`);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
