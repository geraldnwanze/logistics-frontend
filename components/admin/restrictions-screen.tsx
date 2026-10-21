"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { APPLIES_TO_LABELS, FINDING_ACTION_LABELS } from "@/lib/admin/labels";
import { createRestriction, deleteRestriction, emptyRestrictionForm, fetchRestrictions, restrictionToForm, restrictionToInput, updateRestriction, validateRestriction, type Restriction, type RestrictionFilters, type RestrictionForm } from "@/lib/admin/rules";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { AdminProblem } from "./admin-shell";
import { RulesTabs } from "./rules-tabs";

export function restrictionFiltersFrom(params: URLSearchParams): RestrictionFilters {
  const action = params.get("action") ?? "";
  const active = params.get("active") ?? "";
  const country = params.get("country") ?? "";

  return {
    action: action in FINDING_ACTION_LABELS ? action : undefined, active: active === "1" || active === "0" ? active : undefined,
    country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined, q: params.get("q")?.trim().slice(0, 100) || undefined, page: parsePage(params.get("page")),
  };
}

export function restrictionsHref(filters: RestrictionFilters, page = 1): string {
  const search = new URLSearchParams();
  const entries: [string, string | undefined][] = [["action", filters.action], ["active", filters.active], ["country", filters.country], ["q", filters.q], ["page", page > 1 ? String(page) : undefined]];
  for (const [key, value] of entries) if (value) search.set(key, value);
  const text = search.toString();

  return `/admin/rules/screening${text ? `?${text}` : ""}`;
}

/** Create or change one rule. Rules apply to new bookings from the moment they are saved; shipments already held or booked are not re-screened. */
function RestrictionEditor({ initial, onSave, onCancel, saveLabel }: { initial: RestrictionForm; onSave: (form: RestrictionForm) => Promise<void>; onCancel: () => void; saveLabel: string }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof RestrictionForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof RestrictionForm) => (e: { target: { value: string } }) => setForm((cur) => ({ ...cur, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateRestriction(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    setError(null);

    try {
      await onSave(form);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) setErrors({ label: caught.field("label"), keywords: caught.field("keywords"), prefixes: caught.field("hs_prefixes") ?? caught.field("hs_prefixes.0"), country: caught.field("country_code"), reason: caught.field("reason") });
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={saveLabel} className="space-y-3 rounded-md border border-foreground/20 bg-foreground/5 p-4">
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={form.label} onChange={set("label")} error={errors.label} maxLength={200} />
        <SelectField label="What happens" value={form.action} onChange={set("action")}>
          <option value="restricted">Restricted: hold for a compliance officer to review</option>
          <option value="prohibited">Prohibited: refuse the booking</option>
        </SelectField>
        <SelectField label="Applies when the item is" value={form.appliesTo} onChange={set("appliesTo")}>
          {Object.entries(APPLIES_TO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <TextField label="Only for this country (optional)" value={form.country} onChange={set("country")} error={errors.country} maxLength={2} hint="Two-letter code. Blank means every country." />
      </div>
      <div>
        <label htmlFor="rule-keywords" className="mb-1 block text-sm font-medium">Keywords</label>
        <textarea id="rule-keywords" value={form.keywords} onChange={set("keywords")} rows={2} aria-invalid={errors.keywords ? true : undefined} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        <p className="mt-1 text-xs opacity-75">Whole words in the item description, separated by commas or new lines. Capital letters don&apos;t matter.</p>
        {errors.keywords ? <p className="mt-1 text-sm text-red-700">{errors.keywords}</p> : null}
      </div>
      <TextField label="Customs code prefixes (optional)" value={form.prefixes} onChange={set("prefixes")} error={errors.prefixes} hint="HS codes the item starts with, such as 8507 or 3604, separated by commas." />
      <div>
        <label htmlFor="rule-reason" className="mb-1 block text-sm font-medium">Reason (shown to the customer and the reviewer)</label>
        <textarea id="rule-reason" value={form.reason} onChange={set("reason")} rows={2} maxLength={500} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        {errors.reason ? <p className="mt-1 text-sm text-red-700">{errors.reason}</p> : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.active} onChange={(e) => setForm((cur) => ({ ...cur, active: e.target.checked }))} />This rule is in use</label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : saveLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

function RestrictionRow({ rule, onChanged, onSaved }: { rule: Restriction; onChanged: () => Promise<void>; onSaved: (message: string) => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <RestrictionEditor initial={restrictionToForm(rule)} saveLabel="Save changes" onCancel={() => setMode("view")} onSave={async (form) => { await updateRestriction(rule.id, restrictionToInput(form)); setMode("view"); onSaved(`“${form.label.trim()}” was saved.`); await onChanged(); }} />
      </li>
    );
  }

  return (
    <li className={rule.is_active ? "rounded-md border border-foreground/20 p-4" : "rounded-md border border-foreground/20 p-4 opacity-75"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{rule.label}</p>
          <p className="text-sm opacity-80">{APPLIES_TO_LABELS[rule.applies_to] ?? rule.applies_to}{rule.country_code ? ` · only ${rule.country_code}` : " · every country"}</p>
          {rule.keywords.length > 0 ? <p className="mt-1 text-sm"><span className="opacity-75">Keywords:</span> {rule.keywords.join(", ")}</p> : null}
          {rule.hs_prefixes.length > 0 ? <p className="text-sm"><span className="opacity-75">Code prefixes:</span> {rule.hs_prefixes.join(", ")}</p> : null}
          {rule.reason ? <p className="mt-1 text-sm">{rule.reason}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip label={FINDING_ACTION_LABELS[rule.action] ?? rule.action} tone={rule.action === "prohibited" ? "bad" : "warn"} />
          {rule.is_active ? null : <StatusChip label="Not in use" tone="plain" />}
        </div>
      </div>
      <FormAlert message={error} />
      {mode === "delete" ? (
        <div role="group" aria-label={`Confirm deleting ${rule.label}`} className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>Delete “{rule.label}”? Items it would have caught will no longer be screened. Turning it off instead keeps it for later.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => void run(() => deleteRestriction(rule.id), `“${rule.label}” was deleted.`)}>Yes, delete it</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setMode("view")}>Keep it</Button>
        </div>
      ) : (
        <p className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setMode("edit")}>Edit{" "}<span className="sr-only">{rule.label}</span></Button>
          <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => void run(() => updateRestriction(rule.id, { is_active: !rule.is_active }).then(() => undefined), rule.is_active ? `“${rule.label}” is now off.` : `“${rule.label}” is now in use.`)}>{rule.is_active ? "Turn off" : "Turn on"}{" "}<span className="sr-only">{rule.label}</span></Button>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setMode("delete")}>Delete{" "}<span className="sr-only">{rule.label}</span></Button>
        </p>
      )}
    </li>
  );
}

export function RestrictionsScreen() {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const filters = restrictionFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const [search, setSearch] = useState(filters.q ?? "");
  const [country, setCountry] = useState(filters.country ?? "");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin-restrictions", filters], queryFn: ({ signal }) => fetchRestrictions(filters, signal), placeholderData: keepPreviousData, retry: false });
  const go = (change: Partial<RestrictionFilters>) => router.replace(restrictionsHref({ ...filters, ...change, page: undefined }));
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["admin-restrictions"] }); };
  const anyFilter = Boolean(filters.action || filters.active || filters.country || filters.q);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Rules</h1>
      <p className="mt-2 text-sm opacity-80">What the booking form refuses or holds for review. Changes apply to new bookings straight away; shipments already booked are not screened again.</p>
      <div className="mt-4"><RulesTabs current="/admin/rules/screening" /></div>
      {saved ? <p role="status" className="mb-4 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}

      <div className="mb-4">
        {adding ? (
          <RestrictionEditor initial={emptyRestrictionForm} saveLabel="Add rule" onCancel={() => setAdding(false)} onSave={async (form) => { await createRestriction(restrictionToInput(form)); setAdding(false); setSaved(`“${form.label.trim()}” was added.`); await refresh(); }} />
        ) : <Button type="button" onClick={() => { setSaved(null); setAdding(true); }}>New rule</Button>}
      </div>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go({ q: search.trim() || undefined, country: /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : undefined }); }} role="search" aria-label="Filter rules" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="What happens" value={filters.action ?? ""} onChange={(e) => go({ action: e.target.value || undefined })}>
          <option value="">Any</option>
          {Object.entries(FINDING_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="In use" value={filters.active ?? ""} onChange={(e) => go({ active: (e.target.value || undefined) as "1" | "0" | undefined })}>
          <option value="">Either</option>
          <option value="1">In use</option>
          <option value="0">Not in use</option>
        </SelectField>
        <TextField label="Country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} hint="Two-letter code, then Search." />
        <TextField label="Name" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading the rules…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the rules" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No rules match these filters." : "There are no screening rules yet."}</p> : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "rule" : "rules"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching} aria-label="Rules">
              {list.data.items.map((rule) => <RestrictionRow key={rule.id} rule={rule} onChanged={refresh} onSaved={setSaved} />)}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => restrictionsHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
