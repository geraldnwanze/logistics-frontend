import { z } from "zod";
import { apiRequest, ApiError } from "@/lib/api/client";
import { countrySchema, customsSchema, invoiceSchema, pageMetaSchema, paymentStartSchema, quoteSchema, shipmentSchema, type Country, type Customs, type Declaration, type Invoice, type Paged, type Quote, type Shipment } from "./schemas";
import { guestTokenFor } from "./guest";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

export async function fetchCountries(): Promise<Country[]> {
  return parse(z.object({ data: z.array(countrySchema) }), (await apiRequest("/public/countries")).body).data;
}

export type QuoteInput = {
  origin: { country: string; city: string; postal_code?: string };
  destination: { country: string; city: string; postal_code?: string };
  shipment_type: "parcel" | "document" | "freight";
  contents: string;
  unit_system: "metric" | "imperial";
  packages: Record<string, string>[];
  declared_value?: { amount: string; currency: string };
  insurance: boolean;
  currency?: string;
};

export async function createQuote(input: QuoteInput): Promise<Quote> {
  return parse(z.object({ data: quoteSchema }), (await apiRequest("/quotes", { method: "POST", body: input })).body).data;
}

export async function fetchQuote(id: string, signal?: AbortSignal): Promise<Quote> {
  return parse(z.object({ data: quoteSchema }), (await apiRequest(`/quotes/${encodeURIComponent(id)}`, { signal })).body).data;
}

export type Party = {
  name: string; company?: string; phone: string; email?: string; line1: string; line2?: string; city: string; state?: string; postal_code?: string; country: string;
};

export type BookingInput = {
  quote_id: string;
  option_id: string;
  contact_email?: string;
  sender: Party;
  recipient: Party;
  items: { description: string; quantity: number; unit_value: string; hs_code?: string; origin_country: string }[];
  pickup?: { date: string; window_start: string; window_end: string; instructions?: string };
  delivery_instructions?: string;
  terms_accepted: boolean;
};

export async function bookShipment(input: BookingInput, idempotencyKey: string): Promise<Shipment> {
  const { body } = await apiRequest("/shipments", { method: "POST", body: input, headers: { "Idempotency-Key": idempotencyKey } });

  return parse(z.object({ data: shipmentSchema }), body).data;
}

function guestHeaders(shipmentId: string): Record<string, string> {
  const token = guestTokenFor(shipmentId);

  return token ? { "X-Guest-Token": token } : {};
}

export async function fetchShipment(id: string, signal?: AbortSignal): Promise<Shipment> {
  return parse(z.object({ data: shipmentSchema }), (await apiRequest(`/shipments/${encodeURIComponent(id)}`, { signal, headers: guestHeaders(id) })).body).data;
}

/** Starts (or, with the same key, resumes) payment of the invoice. The amount is decided by the server. */
export async function startPayment(shipmentId: string, idempotencyKey: string): Promise<{ id: string; status: string; action: { type: string; url: string; sandbox?: boolean } | null }> {
  const { body } = await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/payments`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey, ...guestHeaders(shipmentId) },
  });

  return parse(z.object({ data: paymentStartSchema }), body).data;
}

/** Development only: plays the sandbox provider's checkout page. The route does not exist in production. */
export async function simulateSandboxPayment(reference: string, outcome: "succeeded" | "failed"): Promise<void> {
  await apiRequest(`/sandbox/payments/${encodeURIComponent(reference)}/simulate`, { method: "POST", body: { outcome } });
}

export type ShipmentFilter = "all" | "active" | "delivered" | "cancelled";

function paged<S extends z.ZodType>(schema: S, body: unknown): Paged<z.infer<S>> {
  const result = parse(z.object({ data: z.array(schema), meta: pageMetaSchema }), body);

  return { items: result.data, page: result.meta.current_page, lastPage: result.meta.last_page, total: result.meta.total };
}

/** The signed-in customer's own shipments (and those of their organisations), newest first. */
export async function fetchShipments({ status, q, page }: { status: ShipmentFilter; q: string; page: number }, signal?: AbortSignal): Promise<Paged<Shipment>> {
  const query = new URLSearchParams();
  if (status !== "all") query.set("status", status);
  if (q.trim() !== "") query.set("q", q.trim());
  if (page > 1) query.set("page", String(page));
  const { body } = await apiRequest(`/shipments${query.size > 0 ? `?${query}` : ""}`, { signal });

  return paged(shipmentSchema, body);
}

export async function cancelShipment(id: string, reason: string): Promise<Shipment> {
  const { body } = await apiRequest(`/shipments/${encodeURIComponent(id)}/cancel`, { method: "POST", body: reason.trim() === "" ? {} : { reason: reason.trim() }, headers: guestHeaders(id) });

  return parse(z.object({ data: shipmentSchema }), body).data;
}

export async function fetchInvoices(page: number, signal?: AbortSignal): Promise<Paged<Invoice>> {
  const { body } = await apiRequest(`/invoices${page > 1 ? `?page=${page}` : ""}`, { signal });

  return paged(invoiceSchema, body);
}

/** A ten-minute signed link to the invoice (a receipt once paid). `shipmentId` lets a guest's token authorise it. */
export async function fetchInvoiceLink(invoiceId: string, shipmentId?: string): Promise<{ url: string; type: string }> {
  const { body } = await apiRequest(`/invoices/${encodeURIComponent(invoiceId)}/pdf`, { headers: shipmentId ? guestHeaders(shipmentId) : {} });

  return parse(z.object({ data: z.object({ url: z.string(), type: z.string() }) }), body).data;
}

export async function fetchCustoms(shipmentId: string, signal?: AbortSignal): Promise<Customs> {
  const { body } = await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/customs`, { signal, headers: guestHeaders(shipmentId) });

  return parse(z.object({ data: customsSchema }), body).data;
}

export async function saveDeclaration(shipmentId: string, declaration: Partial<Declaration>): Promise<Customs> {
  const { body } = await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/customs-declaration`, { method: "PUT", body: declaration, headers: guestHeaders(shipmentId) });

  return parse(z.object({ data: customsSchema }), body).data;
}

export async function uploadDocument(shipmentId: string, file: File, type: string): Promise<{ id: string; type: string; name: string; size: number }> {
  const form = new FormData();
  form.set("file", file);
  form.set("type", type);
  const { body } = await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/documents`, { method: "POST", body: form, headers: guestHeaders(shipmentId) });

  return parse(z.object({ data: z.object({ id: z.string(), type: z.string(), name: z.string(), size: z.number() }) }), body).data;
}

/** Takes back an uploaded document. The API refuses once the shipment is with customs, and for documents we generated. */
export async function removeDocument(shipmentId: string, documentId: string): Promise<void> {
  await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/documents/${encodeURIComponent(documentId)}`, { method: "DELETE", headers: guestHeaders(shipmentId) });
}

const linkSchema = z.object({ data: z.object({ url: z.string(), type: z.string().optional() }) });

/** A ten-minute signed link to a document already on the shipment. */
export async function fetchDocumentLink(shipmentId: string, documentId: string): Promise<{ url: string }> {
  return parse(linkSchema, (await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/documents/${encodeURIComponent(documentId)}`, { headers: guestHeaders(shipmentId) })).body).data;
}

/** Builds (or rebuilds) the commercial invoice or packing list from the shipment's items and declaration, and links to it. */
export async function generateCustomsPaper(shipmentId: string, kind: "commercial-invoice" | "packing-list"): Promise<{ url: string }> {
  return parse(linkSchema, (await apiRequest(`/shipments/${encodeURIComponent(shipmentId)}/customs/${kind}`, { headers: guestHeaders(shipmentId) })).body).data;
}
