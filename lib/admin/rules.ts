import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";
import { currencyDecimals } from "./finance";
import { toMinor } from "@/lib/shipping/money";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

export const DOCUMENT_TYPES = ["commercial_invoice", "packing_list", "export_licence", "certificate_of_origin", "import_permit", "identification", "other"] as const;
export const SHIPMENT_TYPES = ["parcel", "document", "freight"] as const;

export const restrictionSchema = z.object({
  id: z.number(),
  label: z.string(),
  action: z.enum(["prohibited", "restricted"]),
  country_code: z.string().nullable(),
  applies_to: z.enum(["origin", "destination", "any"]),
  keywords: z.array(z.string()).nullish().transform((v) => v ?? []),
  hs_prefixes: z.array(z.string()).nullish().transform((v) => v ?? []),
  reason: z.string().nullable(),
  is_active: z.boolean(),
});
export type Restriction = z.infer<typeof restrictionSchema>;

export const requirementSchema = z.object({
  id: z.number(),
  country_code: z.string(),
  direction: z.enum(["import", "export"]),
  document_type: z.string(),
  label: z.string(),
  shipment_types: z.array(z.string()).nullish().transform((v) => v ?? []),
  min_declared_value_minor: z.number().nullish().transform((v) => v ?? 0),
  value_currency: z.string().nullish().transform((v) => v ?? "USD"),
  is_mandatory: z.boolean(),
  requires_hs_code: z.boolean(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
});
export type Requirement = z.infer<typeof requirementSchema>;

const meta = z.object({ total: z.number(), last_page: z.number() });

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();

  return text ? `?${text}` : "";
}

export type RestrictionFilters = { action?: string; active?: "1" | "0"; country?: string; q?: string; page?: number };

export async function fetchRestrictions(filters: RestrictionFilters, signal?: AbortSignal): Promise<Paged<Restriction>> {
  const { body } = await apiRequest(`/admin/item-restrictions${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(restrictionSchema), meta }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export type RestrictionInput = { label: string; action: string; country_code: string | null; applies_to: string; keywords: string[]; hs_prefixes: string[]; reason: string | null; is_active: boolean };

export async function createRestriction(input: RestrictionInput): Promise<Restriction> {
  return parse(z.object({ data: restrictionSchema }), (await apiRequest("/admin/item-restrictions", { method: "POST", body: input })).body).data;
}

export async function updateRestriction(id: number, input: Partial<RestrictionInput>): Promise<Restriction> {
  return parse(z.object({ data: restrictionSchema }), (await apiRequest(`/admin/item-restrictions/${id}`, { method: "PATCH", body: input })).body).data;
}

export async function deleteRestriction(id: number): Promise<void> {
  await apiRequest(`/admin/item-restrictions/${id}`, { method: "DELETE" });
}

export type RequirementFilters = { country?: string; direction?: string; page?: number };

export async function fetchRequirements(filters: RequirementFilters, signal?: AbortSignal): Promise<Paged<Requirement>> {
  const { body } = await apiRequest(`/admin/customs-requirements${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(requirementSchema), meta }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export type RequirementInput = { country_code: string; direction: string; document_type: string; label: string; shipment_types: string[] | null; min_declared_value_minor: number; value_currency: string; is_mandatory: boolean; requires_hs_code: boolean; notes: string | null; is_active: boolean };

export async function createRequirement(input: RequirementInput): Promise<Requirement> {
  return parse(z.object({ data: requirementSchema }), (await apiRequest("/admin/customs-requirements", { method: "POST", body: input })).body).data;
}

export async function updateRequirement(id: number, input: Partial<RequirementInput>): Promise<Requirement> {
  return parse(z.object({ data: requirementSchema }), (await apiRequest(`/admin/customs-requirements/${id}`, { method: "PATCH", body: input })).body).data;
}

export async function deleteRequirement(id: number): Promise<void> {
  await apiRequest(`/admin/customs-requirements/${id}`, { method: "DELETE" });
}

/** "battery, lithium\nlithium cell" becomes ["battery", "lithium", "lithium cell"]: split on commas and lines, trimmed, no blanks, no repeats ignoring case. */
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of text.split(/[,\n]/)) {
    const value = part.trim();
    if (value !== "" && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }

  return out;
}

export type RestrictionForm = { label: string; action: string; country: string; appliesTo: string; keywords: string; prefixes: string; reason: string; active: boolean };

export const emptyRestrictionForm: RestrictionForm = { label: "", action: "restricted", country: "", appliesTo: "any", keywords: "", prefixes: "", reason: "", active: true };

export function restrictionToForm(r: Restriction): RestrictionForm {
  return { label: r.label, action: r.action, country: r.country_code ?? "", appliesTo: r.applies_to, keywords: r.keywords.join(", "), prefixes: r.hs_prefixes.join(", "), reason: r.reason ?? "", active: r.is_active };
}

/** What to fix before sending, in the words the screen uses. The API checks the same things and has the last word. */
export function validateRestriction(f: RestrictionForm): Partial<Record<keyof RestrictionForm, string>> {
  const errors: Partial<Record<keyof RestrictionForm, string>> = {};
  const keywords = splitList(f.keywords);
  const prefixes = splitList(f.prefixes);

  if (f.label.trim() === "") errors.label = "Give the rule a name people will recognise.";
  if (f.country.trim() !== "" && !/^[A-Za-z]{2}$/.test(f.country.trim())) errors.country = "Use the two-letter country code, for example DE, or leave it blank for every country.";
  if (keywords.length === 0 && prefixes.length === 0) errors.keywords = "Add at least one keyword or customs code prefix, otherwise the rule can never match.";
  else if (keywords.some((k) => k.length < 2 || k.length > 60)) errors.keywords = "Each keyword needs 2 to 60 characters.";
  else if (keywords.length > 100) errors.keywords = "At most 100 keywords.";
  if (prefixes.some((p) => !/^\d{2,10}$/.test(p))) errors.prefixes = "Customs code prefixes are 2 to 10 digits, separated by commas.";
  if (f.reason.length > 500) errors.reason = "Keep the reason under 500 characters.";

  return errors;
}

export function restrictionToInput(f: RestrictionForm): RestrictionInput {
  return { label: f.label.trim(), action: f.action, country_code: f.country.trim() ? f.country.trim().toUpperCase() : null, applies_to: f.appliesTo, keywords: splitList(f.keywords), hs_prefixes: splitList(f.prefixes), reason: f.reason.trim() || null, is_active: f.active };
}

export type RequirementForm = { country: string; direction: string; documentType: string; label: string; types: string[]; minValue: string; currency: string; mandatory: boolean; hs: boolean; notes: string; active: boolean };

export const emptyRequirementForm: RequirementForm = { country: "", direction: "export", documentType: "commercial_invoice", label: "", types: [], minValue: "", currency: "USD", mandatory: true, hs: false, notes: "", active: true };

export function requirementToForm(r: Requirement): RequirementForm {
  const decimals = currencyDecimals(r.value_currency);
  const text = r.min_declared_value_minor.toString().padStart(decimals + 1, "0");

  return {
    country: r.country_code, direction: r.direction, documentType: r.document_type, label: r.label, types: r.shipment_types, currency: r.value_currency, mandatory: r.is_mandatory, hs: r.requires_hs_code, notes: r.notes ?? "", active: r.is_active,
    minValue: r.min_declared_value_minor === 0 ? "" : decimals === 0 ? text : `${text.slice(0, -decimals)}.${text.slice(-decimals)}`,
  };
}

export function validateRequirement(f: RequirementForm): Partial<Record<keyof RequirementForm, string>> {
  const errors: Partial<Record<keyof RequirementForm, string>> = {};

  if (!/^[A-Za-z]{2}$/.test(f.country.trim())) errors.country = "Use the two-letter country code, for example DE.";
  if (f.label.trim() === "") errors.label = "Say what the customer is asked for, in words they will understand.";
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) errors.currency = "Use the three-letter currency code, for example USD.";
  else if (f.minValue.trim() !== "" && toMinor(f.minValue, currencyDecimals(f.currency.trim().toUpperCase())) === null) errors.minValue = `Enter an amount with at most ${currencyDecimals(f.currency.trim().toUpperCase())} decimal places.`;
  if (f.notes.length > 1000) errors.notes = "Keep the notes under 1000 characters.";

  return errors;
}

export function requirementToInput(f: RequirementForm): RequirementInput {
  const currency = f.currency.trim().toUpperCase();
  const minor = f.minValue.trim() === "" ? BigInt(0) : (toMinor(f.minValue, currencyDecimals(currency)) ?? BigInt(0));

  return {
    country_code: f.country.trim().toUpperCase(), direction: f.direction, document_type: f.documentType, label: f.label.trim(), shipment_types: f.types.length > 0 ? f.types : null,
    min_declared_value_minor: Number(minor), value_currency: currency, is_mandatory: f.mandatory, requires_hs_code: f.hs, notes: f.notes.trim() || null, is_active: f.active,
  };
}
