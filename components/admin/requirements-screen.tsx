"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { formatMinorAmount } from "@/lib/admin/finance";
import { DIRECTION_LABELS, SHIPMENT_TYPE_LABELS } from "@/lib/admin/labels";
import { createRequirement, deleteRequirement, DOCUMENT_TYPES, emptyRequirementForm, fetchRequirements, requirementToForm, requirementToInput, SHIPMENT_TYPES, updateRequirement, validateRequirement, type Requirement, type RequirementFilters, type RequirementForm } from "@/lib/admin/rules";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { DOCUMENT_LABELS } from "@/lib/shipping/customs-labels";
import { AdminProblem } from "./admin-shell";
import { RulesTabs } from "./rules-tabs";

export function requirementFiltersFrom(params: URLSearchParams): RequirementFilters {
  const country = params.get("country") ?? "";
  const direction = params.get("direction") ?? "";

  return { country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined, direction: direction in DIRECTION_LABELS ? direction : undefined, page: parsePage(params.get("page")) };
}

export function requirementsHref(filters: RequirementFilters, page = 1): string {
  const search = new URLSearchParams();
  if (filters.country) search.set("country", filters.country);
  if (filters.direction) search.set("direction", filters.direction);
  if (page > 1) search.set("page", String(page));
  const text = search.toString();

  return `/admin/rules/documents${text ? `?${text}` : ""}`;
}

/** When a requirement applies, in a sentence a person can check against the rule they meant. */
export function describeWhen(r: Requirement): string {
  const types = r.shipment_types.length > 0 ? r.shipment_types.map((t) => SHIPMENT_TYPE_LABELS[t]?.toLowerCase() ?? t).join(", ") : "every kind of shipment";
  const value = r.min_declared_value_minor > 0 ? `declared at ${formatMinorAmount(r.min_declared_value_minor, r.value_currency)} or more` : "of any value";

  return `For ${types}, ${value}.`;
}

function RequirementEditor({ initial, onSave, onCancel, saveLabel }: { initial: RequirementForm; onSave: (form: RequirementForm) => Promise<void>; onCancel: () => void; saveLabel: string }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof RequirementForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof RequirementForm) => (e: { target: { value: string } }) => setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const flag = (key: "mandatory" | "hs" | "active") => (e: { target: { checked: boolean } }) => setForm((cur) => ({ ...cur, [key]: e.target.checked }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateRequirement(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    setError(null);

    try {
      await onSave(form);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) setErrors({ country: caught.field("country_code"), label: caught.field("label"), currency: caught.field("value_currency"), minValue: caught.field("min_declared_value_minor"), notes: caught.field("notes") });
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={saveLabel} className="space-y-3 rounded-md border border-foreground/20 bg-foreground/5 p-4">
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Country" value={form.country} onChange={set("country")} error={errors.country} maxLength={2} hint="Two-letter code, for example DE." />
        <SelectField label="Which way" value={form.direction} onChange={set("direction")}>
          {Object.entries(DIRECTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="Document" value={form.documentType} onChange={set("documentType")}>
          {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t] ?? t.replace(/_/g, " ")}</option>)}
        </SelectField>
        <TextField label="What the customer sees" value={form.label} onChange={set("label")} error={errors.label} maxLength={200} />
      </div>
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="mb-1 text-sm font-medium">Applies to (none ticked means every kind)</legend>
        {SHIPMENT_TYPES.map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.types.includes(t)} onChange={(e) => setForm((cur) => ({ ...cur, types: e.target.checked ? [...cur.types, t] : cur.types.filter((x) => x !== t) }))} />{SHIPMENT_TYPE_LABELS[t]}</label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Only when the declared value is at least (optional)" inputMode="decimal" value={form.minValue} onChange={set("minValue")} error={errors.minValue} hint="Leave blank for any value." />
        <TextField label="Currency of that amount" value={form.currency} onChange={set("currency")} error={errors.currency} maxLength={3} />
      </div>
      <div>
        <label htmlFor="req-notes" className="mb-1 block text-sm font-medium">Notes for the customer (optional)</label>
        <textarea id="req-notes" value={form.notes} onChange={set("notes")} rows={2} maxLength={1000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        {errors.notes ? <p className="mt-1 text-sm text-red-700">{errors.notes}</p> : null}
      </div>
      <div className="flex flex-wrap gap-x-6">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.mandatory} onChange={flag("mandatory")} />Required before the shipment can leave</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.hs} onChange={flag("hs")} />Items need a customs (HS) code</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.active} onChange={flag("active")} />This requirement is in use</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : saveLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

function RequirementRow({ req, onChanged, onSaved }: { req: Requirement; onChanged: () => Promise<void>; onSaved: (message: string) => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${DOCUMENT_LABELS[req.document_type] ?? req.document_type} for ${req.country_code}`;

  async function run(action: () => Promise<void>, done: string) {
    setPending(true);
    setError(null);

    try {
      await action();
      setMode("view");
      onSaved(done);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "in_use" ? caught.message : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  if (mode === "edit") {
    return (
      <li>
        <RequirementEditor initial={requirementToForm(req)} saveLabel="Save changes" onCancel={() => setMode("view")} onSave={async (form) => { await updateRequirement(req.id, requirementToInput(form)); setMode("view"); onSaved(`${name} was saved.`); await onChanged(); }} />
      </li>
    );
  }

  return (
    <li className={req.is_active ? "rounded-md border border-foreground/20 p-4" : "rounded-md border border-foreground/20 p-4 opacity-75"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{req.country_code} · {DIRECTION_LABELS[req.direction] ?? req.direction}</p>
          <p className="text-sm">{DOCUMENT_LABELS[req.document_type] ?? req.document_type}: “{req.label}”</p>
          <p className="text-sm opacity-80">{describeWhen(req)}{req.requires_hs_code ? " Items need a customs code." : ""}</p>
          {req.notes ? <p className="mt-1 text-sm">{req.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip label={req.is_mandatory ? "Required" : "Optional"} tone={req.is_mandatory ? "warn" : "plain"} />
          {req.is_active ? null : <StatusChip label="Not in use" tone="plain" />}
        </div>
      </div>
      <FormAlert message={error} />
      {mode === "delete" ? (
        <div role="group" aria-label={`Confirm deleting ${name}`} className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>Delete this requirement? Customers will no longer be asked for it. Turning it off instead keeps it for later.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => void run(() => deleteRequirement(req.id), `${name} was deleted.`)}>Yes, delete it</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setMode("view")}>Keep it</Button>
        </div>
      ) : (
        <p className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setMode("edit")}>Edit{" "}<span className="sr-only">{name}</span></Button>
          <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => void run(() => updateRequirement(req.id, { is_active: !req.is_active }).then(() => undefined), req.is_active ? `${name} is now off.` : `${name} is now in use.`)}>{req.is_active ? "Turn off" : "Turn on"}{" "}<span className="sr-only">{name}</span></Button>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setMode("delete")}>Delete{" "}<span className="sr-only">{name}</span></Button>
        </p>
      )}
    </li>
  );
}

export function RequirementsScreen() {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const filters = requirementFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const [country, setCountry] = useState(filters.country ?? "");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin-requirements", filters], queryFn: ({ signal }) => fetchRequirements(filters, signal), placeholderData: keepPreviousData, retry: false });
  const go = (change: Partial<RequirementFilters>) => router.replace(requirementsHref({ ...filters, ...change, page: undefined }));
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["admin-requirements"] }); };
  const anyFilter = Boolean(filters.country || filters.direction);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Rules</h1>
      <p className="mt-2 text-sm opacity-80">Which documents customers are asked for, country by country. Changes apply to checklists straight away, including shipments already booked. Required export documents also hold a shipment at the border.</p>
      <div className="mt-4"><RulesTabs current="/admin/rules/documents" /></div>
      {saved ? <p role="status" className="mb-4 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}

      <div className="mb-4">
        {adding ? (
          <RequirementEditor initial={emptyRequirementForm} saveLabel="Add requirement" onCancel={() => setAdding(false)} onSave={async (form) => { await createRequirement(requirementToInput(form)); setAdding(false); setSaved(`A requirement for ${form.country.trim().toUpperCase()} was added.`); await refresh(); }} />
        ) : <Button type="button" onClick={() => { setSaved(null); setAdding(true); }}>New requirement</Button>}
      </div>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go({ country: /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : undefined }); }} role="search" aria-label="Filter requirements" className="grid gap-3 sm:grid-cols-3">
        <TextField label="Country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} hint="Two-letter code, then Search." />
        <SelectField label="Which way" value={filters.direction ?? ""} onChange={(e) => go({ direction: e.target.value || undefined })}>
          <option value="">Either</option>
          {Object.entries(DIRECTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading the requirements…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the requirements" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No requirements match these filters." : "There are no document requirements yet."}</p> : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "requirement" : "requirements"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching} aria-label="Requirements">
              {list.data.items.map((r) => <RequirementRow key={r.id} req={r} onChanged={refresh} onSaved={setSaved} />)}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => requirementsHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
