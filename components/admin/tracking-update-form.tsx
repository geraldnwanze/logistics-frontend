"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { EXCEPTION_REASONS } from "@/lib/admin/labels";
import type { TrackingUpdate } from "@/lib/admin/shipments";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";

type Values = { status: string; when: string; description: string; internal: string; isPublic: boolean; reason: string; recipient: string; city: string; country: string; facility: string };

const EMPTY: Values = { status: "", when: "", description: "", internal: "", isPublic: true, reason: "", recipient: "", city: "", country: "", facility: "" };

/** Problems to fix before sending, in words a person can act on. Times in the future are refused by the API too (five minutes' grace). */
export function validateUpdate(v: Values, now = Date.now()): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {};
  if (v.status === "") errors.status = "Choose the status to move the shipment to.";
  if (v.when !== "" && (Number.isNaN(Date.parse(v.when)) || Date.parse(v.when) > now + 5 * 60_000)) errors.when = "Enter a time that is not in the future.";
  if (v.status === "exception" && v.reason === "") errors.reason = "Say what went wrong.";
  if (v.country !== "" && !/^[A-Za-z]{2}$/.test(v.country.trim())) errors.country = "Use the two-letter country code, for example DE.";
  if (v.description.length > 500) errors.description = "Keep the public description under 500 characters.";

  return errors;
}

export function toUpdate(v: Values): TrackingUpdate {
  const location = { ...(v.city.trim() ? { city: v.city.trim() } : {}), ...(v.country.trim() ? { country: v.country.trim().toUpperCase() } : {}), ...(v.facility.trim() ? { facility: v.facility.trim() } : {}) };

  return {
    status: v.status, is_public: v.isPublic,
    ...(v.when ? { occurred_at: new Date(v.when).toISOString() } : {}),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    ...(v.internal.trim() ? { internal_note: v.internal.trim() } : {}),
    ...(v.status === "exception" && v.reason ? { exception_code: v.reason } : {}),
    ...(v.status === "delivered" && v.recipient.trim() ? { recipient_name: v.recipient.trim() } : {}),
    ...(Object.keys(location).length > 0 ? { location } : {}),
  };
}

export function TrackingUpdateForm({ allowed, onSubmit }: { allowed: { code: string; label: string }[]; onSubmit: (update: TrackingUpdate) => Promise<void> }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) return <p role="status" className="rounded-md border border-foreground/20 p-4 text-sm">This shipment is at a final status, so it can&apos;t be moved by hand.</p>;

  const set = (key: keyof Values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function review(event: FormEvent) {
    event.preventDefault();
    const found = validateUpdate(values);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function send() {
    setPending(true);
    setError(null);

    try {
      await onSubmit(toUpdate(values));
      setValues(EMPTY);   // the page stays mounted after navigating
      setConfirming(false);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) {
        setErrors({ when: caught.field("occurred_at"), description: caught.field("description"), country: caught.field("location.country"), reason: caught.field("exception_code"), status: caught.field("status") });
        setError(caught.message);
      } else {
        setError(caught instanceof ApiError && caught.code === "invalid_transition" ? caught.message : describeError(caught));
      }
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  const chosen = allowed.find((a) => a.code === values.status);

  return (
    <form onSubmit={review} noValidate aria-label="Add a tracking update" className="space-y-4">
      <FormAlert message={error} />
      <SelectField label="Move the shipment to" value={values.status} onChange={set("status")} error={errors.status} disabled={confirming} required>
        <option value="">Choose a status…</option>
        {allowed.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
      </SelectField>
      <TextField label="When it happened" type="datetime-local" value={values.when} onChange={set("when")} error={errors.when} disabled={confirming} hint="Leave blank for now. Saved in UTC unless the location is a known facility." />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="City" value={values.city} onChange={set("city")} disabled={confirming} maxLength={120} />
        <TextField label="Country code" value={values.country} onChange={set("country")} error={errors.country} disabled={confirming} maxLength={2} />
        <TextField label="Facility" value={values.facility} onChange={set("facility")} disabled={confirming} maxLength={160} />
      </div>
      {values.status === "exception" ? (
        <SelectField label="What went wrong" value={values.reason} onChange={set("reason")} error={errors.reason} disabled={confirming} required>
          <option value="">Choose a reason…</option>
          {EXCEPTION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </SelectField>
      ) : null}
      {values.status === "delivered" ? <TextField label="Received by" value={values.recipient} onChange={set("recipient")} disabled={confirming} maxLength={160} hint="Customers only see the initials." /> : null}
      <div>
        <label htmlFor="tracking-description" className="mb-1 block text-sm font-medium">Message for the customer</label>
        <textarea id="tracking-description" value={values.description} onChange={set("description")} rows={2} maxLength={500} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        {errors.description ? <p className="mt-1 text-sm text-red-700">{errors.description}</p> : null}
      </div>
      <div>
        <label htmlFor="tracking-internal" className="mb-1 block text-sm font-medium">Internal note (staff only)</label>
        <textarea id="tracking-internal" value={values.internal} onChange={set("internal")} rows={2} maxLength={2000} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={values.isPublic} onChange={(e) => setValues((c) => ({ ...c, isPublic: e.target.checked }))} disabled={confirming} />Show this update to the customer</label>
      {confirming ? (
        <div role="group" aria-label="Confirm update" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>Move to “{chosen?.label}”? {values.isPublic ? "The customer will see this and may be notified." : "Only staff will see this."} Updates can&apos;t be edited afterwards.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={send}>{pending ? "Saving…" : "Yes, add the update"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : (
        <Button type="submit">Review update</Button>
      )}
    </form>
  );
}
