"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { useCurrentUser } from "@/lib/auth/session";
import { fetchShipment } from "@/lib/shipping/api";
import { formatMoney } from "@/lib/shipping/format";
import { toMinor } from "@/lib/shipping/money";
import { fileClaim, fetchClaimLimits } from "@/lib/support/api";
import { CLAIM_TYPE_LABELS } from "@/lib/support/labels";
import { CLAIM_TYPES, type ClaimLimits, type ClaimType } from "@/lib/support/schemas";
import { rememberClaimShipment } from "@/lib/support/tokens";
import { AttachmentPicker } from "@/components/support/attachment-picker";
import { ATTACHMENT_ERRORS } from "@/components/support/new-ticket-form";

type Values = { amount: string; incident: string; description: string; email: string };
type Errors = Partial<Record<keyof Values | "type", string>>;

export function validateClaim(values: Values, type: ClaimType | null, limits: ClaimLimits, bounds: { min: string; max: string }, signedIn: boolean): Errors {
  const errors: Errors = {};
  if (type === null) errors.type = "Choose what went wrong.";

  const minor = toMinor(values.amount, limits.decimals);
  if (values.amount.trim() === "") errors.amount = "Enter the amount you are claiming.";
  else if (minor === null) errors.amount = `Enter an amount with at most ${limits.decimals} decimal places, for example 20.50.`;
  else if (minor <= BigInt(0)) errors.amount = "The amount must be more than zero.";
  else if (minor > BigInt(limits.cap.amount_minor)) errors.amount = `The most this shipment is covered for is ${formatMoney(limits.cap)}.`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.incident)) errors.incident = "Choose the date it happened.";
  else if (values.incident > bounds.max) errors.incident = "The date can't be in the future.";
  else if (values.incident < bounds.min) errors.incident = "The date can't be before you booked this shipment.";

  if (values.description.trim().length < 10) errors.description = "Please describe what happened in at least 10 characters.";
  else if (values.description.length > 5000) errors.description = "Use at most 5,000 characters.";
  if (!signedIn && values.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";

  return errors;
}

export function ClaimForm({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const signedIn = Boolean(user);
  const limits = useQuery({ queryKey: ["claim-limits", shipmentId], queryFn: ({ signal }) => fetchClaimLimits(shipmentId, signal), retry: false });
  const shipment = useQuery({ queryKey: ["shipment", shipmentId], queryFn: ({ signal }) => fetchShipment(shipmentId, signal), retry: false });
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<ClaimType | null>(null);
  const [values, setValues] = useState<Values>({ amount: "", incident: today, description: "", email: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  if (limits.isPending || shipment.isPending) return <p role="status">Checking what you can claim for…</p>;

  if (limits.isError || shipment.isError) {
    const missing = [limits.error, shipment.error].some((e) => e instanceof ApiError && e.status === 404);

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this shipment. If you booked as a guest, open this page in the same browser tab you booked in." : "We couldn't load this page right now."}</p>
        <div className="mt-3 flex gap-2">{missing ? <Link href="/support" className={buttonVariants({ size: "sm" })}>Contact support instead</Link> : <Button size="sm" variant="outline" onClick={() => { void limits.refetch(); void shipment.refetch(); }}>Try again</Button>}</div>
      </div>
    );
  }

  const l = limits.data;
  const s = shipment.data;
  const bounds = { min: s.created_at.slice(0, 10), max: today };
  const eligible = CLAIM_TYPES.filter((t) => l.eligibility[t]?.eligible);
  const chosen = type ?? eligible[0] ?? null;
  const set = (field: keyof Values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problems = validateClaim(values, chosen, l, bounds, signedIn);
    setErrors(problems);
    if (Object.keys(problems).length > 0 || chosen === null) return;

    setPending(true);

    try {
      const claim = await fileClaim(shipmentId, { type: chosen, claimed_amount: values.amount.trim(), description: values.description.trim(), incident_date: values.incident, ...(!signedIn && values.email.trim() ? { email: values.email.trim() } : {}) }, files);
      rememberClaimShipment(claim.id, shipmentId);
      setFiles([]);
      setValues((current) => ({ ...current, amount: "", description: "" }));   // the page stays mounted (hidden) after navigating
      router.push(`/claims/${encodeURIComponent(claim.id)}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors({ amount: caught.field("claimed_amount"), incident: caught.field("incident_date"), description: caught.field("description"), email: caught.field("email"), type: caught.field("type") });
      } else if (caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code)) {
        setFormError(caught.message);
      } else if (caught instanceof ApiError && (caught.code === "claim_exists" || caught.code === "claim_not_eligible")) {
        setFormError(caught.message);
        await limits.refetch();
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <p className="text-sm">For shipment <Link href={`/shipments/${encodeURIComponent(shipmentId)}`} className="font-mono underline">{s.tracking_number}</Link>. Not sure a claim is right? <Link href={`/support?shipment=${encodeURIComponent(s.tracking_number)}&ref=${encodeURIComponent(shipmentId)}`} className="underline">Talk to support first</Link>.</p>
      <FormAlert message={formError} />

      <fieldset className="space-y-3">
        <legend className="text-lg font-semibold">What went wrong?</legend>
        {CLAIM_TYPES.map((t) => {
          const info = l.eligibility[t];
          const available = Boolean(info?.eligible);

          return (
            <div key={t} className={available ? "" : "opacity-70"}>
              <label className="flex items-center gap-2">
                <input type="radio" name="claim-type" value={t} checked={chosen === t} disabled={!available} onChange={() => setType(t)} aria-describedby={info?.reason ? `reason-${t}` : undefined} />
                {CLAIM_TYPE_LABELS[t]}
              </label>
              {info?.reason ? <p id={`reason-${t}`} className="ml-6 text-sm">{info.reason}</p> : null}
            </div>
          );
        })}
        {errors.type ? <p className="text-sm text-red-700">{errors.type}</p> : null}
      </fieldset>

      {eligible.length === 0 ? (
        <p role="status" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950">You can&apos;t make a claim on this shipment right now. If something is wrong, <Link href={`/support?shipment=${encodeURIComponent(s.tracking_number)}&ref=${encodeURIComponent(shipmentId)}`} className="underline">contact support</Link> and we&apos;ll help.</p>
      ) : (
        <>
          <p className="rounded-md bg-foreground/5 p-3 text-sm">
            This shipment is covered for up to <strong>{formatMoney(l.cap)}</strong>.{" "}
            {l.insured ? "That's the value you declared (plus the shipping charges when they're in the same currency), because you insured it." : "That's what you paid for shipping, because the shipment wasn't insured."} Claims must be made within {l.window_days} days of delivery.
          </p>
          <TextField label={`Amount you are claiming (${l.currency})`} inputMode="decimal" value={values.amount} onChange={set("amount")} error={errors.amount} required />
          <TextField label="Date it happened" type="date" min={bounds.min} max={bounds.max} value={values.incident} onChange={set("incident")} error={errors.incident} required />
          <div>
            <label htmlFor="claim-description" className="mb-1 block text-sm font-medium">What happened?</label>
            <textarea id="claim-description" value={values.description} onChange={set("description")} rows={6} maxLength={5000} required aria-invalid={errors.description ? true : undefined} aria-describedby={errors.description ? "claim-description-error" : undefined} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
            <p className="mt-1 text-xs opacity-75">Include what was lost or damaged and how you know. {values.description.length}/5000</p>
            {errors.description ? <p id="claim-description-error" className="mt-1 text-sm text-red-700">{errors.description}</p> : null}
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={pending} hint="Photos of the damage, the packaging and the shipping label help us decide faster. Receipts or proof of value are useful too." />
          {!signedIn ? <TextField label="Email (optional)" type="email" value={values.email} onChange={set("email")} error={errors.email} hint="Where we'll send updates. If you leave it blank we use the email from your booking." /> : null}
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Submit claim"}</Button>
        </>
      )}
    </form>
  );
}

