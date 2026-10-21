"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { currencyDecimals, formatMinorAmount } from "@/lib/admin/finance";
import { fetchCustomsOverview, payCustomsCharge, recordCustomsCharge, reviewCompliance, waiveCustomsCharge, type Charge } from "@/lib/admin/customs";
import { CHARGE_STATUS_LABELS, CHARGE_TYPE_LABELS, can, COMPLIANCE_STATUS_LABELS, complianceTone, FINDING_ACTION_LABELS, PAYER_LABELS } from "@/lib/admin/labels";
import type { ShipmentDetail } from "@/lib/admin/shipments";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";
import { DOCUMENT_LABELS } from "@/lib/shipping/customs-labels";
import { decimalPlaces, formatMinor, toMinor } from "@/lib/shipping/money";
import { AdminProblem } from "./admin-shell";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/**
 * Why a shipment is held, and the decision. Everyone who can open the shipment sees the state; only compliance staff decide.
 * Rejecting cancels the booking and refunds the customer, so the confirmation says so.
 */
export function CompliancePanel({ shipment, user, onDone }: { shipment: ShipmentDetail; user: User; onDone: () => Promise<void> }) {
  const c = shipment.compliance;
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refundable = shipment.invoice?.refundable_minor ?? 0;

  if (c.status === "clear") return null;

  async function decide() {
    setPending(true);
    setError(null);

    try {
      await reviewCompliance(shipment.id, decision, note.trim());
      setNote("");
      await onDone();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "no_review_pending" ? "Someone else has already decided this. The page now shows the outcome." : describeError(caught));
      if (caught instanceof ApiError && caught.code === "no_review_pending") await onDone();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby="compliance-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="compliance-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">Compliance <StatusChip label={COMPLIANCE_STATUS_LABELS[c.status] ?? c.status} tone={complianceTone(c.status)} /></h2>
      {c.findings.length > 0 ? (
        <ul aria-label="What matched" className="mt-3 space-y-2">
          {c.findings.map((f, i) => (
            <li key={i} className="rounded-md border border-foreground/15 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><StatusChip label={FINDING_ACTION_LABELS[f.action] ?? f.action} tone={f.action === "prohibited" ? "bad" : "warn"} /><strong>{f.label}</strong></p>
              <p className="mt-1">Item {f.index + 1}: {shipment.items[f.index]?.description ?? "not found in the item list"}{f.matched ? <> · matched “{Array.isArray(f.matched) ? f.matched.join(", ") : f.matched}”</> : null}</p>
              {f.reason ? <p className="mt-1 opacity-80">{f.reason}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {c.status !== "review_required" ? (
        <p className="mt-3 text-sm">{c.status === "approved" ? "Approved" : "Rejected"}{c.reviewed_at ? ` on ${when(c.reviewed_at)}` : ""}{c.note ? <>: {c.note}</> : "."}</p>
      ) : can(user, "customs.manage") ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim() !== "") setConfirming(true); }} aria-label="Decide" className="mt-4 space-y-3">
          <FormAlert message={error} />
          <p className="text-sm">The shipment cannot get a label, be manifested or leave the country until this is decided.</p>
          <fieldset className="flex flex-wrap gap-4" disabled={confirming}>
            <legend className="sr-only">Decision</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="compliance-decision" className="size-5" checked={decision === "approve"} onChange={() => setDecision("approve")} />Approve</label>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="compliance-decision" className="size-5" checked={decision === "reject"} onChange={() => setDecision("reject")} />Reject</label>
          </fieldset>
          <div>
            <label htmlFor="compliance-note" className="mb-1 block text-sm font-medium">Reason (kept on the record{decision === "reject" ? "; the customer will see that it was rejected" : ""})</label>
            <textarea id="compliance-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          </div>
          {confirming ? (
            <div role="group" aria-label="Confirm decision" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
              <span>{decision === "approve" ? "Release the hold and let this shipment proceed?" : `Reject this shipment? The booking is cancelled${refundable > 0 ? ` and ${formatMinor(BigInt(refundable), decimalPlaces(shipment.total.amount), shipment.total.currency)} is refunded to the customer` : ""}. This can't be undone.`}</span>
              <Button type="button" className="min-h-11" disabled={pending} onClick={decide}>{pending ? "Saving…" : decision === "approve" ? "Yes, approve" : "Yes, reject and cancel"}</Button>
              <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
            </div>
          ) : (
            <Button type="submit" disabled={note.trim() === ""}>Review decision</Button>
          )}
        </form>
      ) : <p className="mt-3 text-sm">A compliance officer will review this.</p>}
    </section>
  );
}

function ChargeRow({ charge, onDone, onError }: { charge: Charge; onDone: () => Promise<void>; onError: (message: string | null) => void }) {
  const [mode, setMode] = useState<"idle" | "pay" | "waive">("idle");
  const [payer, setPayer] = useState("recipient");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<void>) {
    setPending(true);
    onError(null);

    try {
      await action();
      setMode("idle");
      setReference("");
      await onDone();
    } catch (caught) {
      onError(caught instanceof ApiError && caught.code === "charge_not_payable" ? "This charge has already been settled. The page now shows its current state." : describeError(caught));
      if (caught instanceof ApiError && caught.code === "charge_not_payable") await onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded-md border border-foreground/20 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2"><StatusChip label={CHARGE_STATUS_LABELS[charge.status] ?? charge.status} tone={charge.status === "paid" ? "good" : charge.status === "assessed" ? "warn" : "plain"} /><strong>{CHARGE_TYPE_LABELS[charge.type] ?? charge.type}: {formatMinorAmount(charge.amount_minor, charge.currency)}</strong></p>
      <p className="mt-1">{charge.description}{charge.assessed_by ? ` · assessed by ${charge.assessed_by}` : ""}{charge.authority_reference ? ` · ${charge.authority_reference}` : ""}{charge.paid_at ? ` · paid ${when(charge.paid_at)}` : ""}</p>
      {charge.status === "assessed" && mode === "idle" ? (
        <p className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setMode("pay")}>Record payment{" "}<span className="sr-only">of {charge.description}</span></Button>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setMode("waive")}>Waive{" "}<span className="sr-only">{charge.description}</span></Button>
        </p>
      ) : null}
      {mode === "pay" ? (
        <form aria-label={`Record payment of ${charge.description}`} className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (reference.trim() !== "") void run(() => payCustomsCharge(charge.id, payer, reference.trim())); }}>
          <SelectField label="Paid by" value={payer} onChange={(e) => setPayer(e.target.value)}>{Object.entries(PAYER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
          <TextField label="Payment reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          <div className="flex items-end gap-2"><Button type="submit" className="min-h-11" disabled={pending || reference.trim() === ""}>Save payment</Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => setMode("idle")}>Cancel</Button></div>
        </form>
      ) : null}
      {mode === "waive" ? (
        <div role="group" aria-label={`Confirm waiving ${charge.description}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3">
          <span>Waive {formatMinorAmount(charge.amount_minor, charge.currency)}? Nobody will be asked to pay it. This can&apos;t be undone.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => void run(() => waiveCustomsCharge(charge.id))}>Yes, waive it</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setMode("idle")}>Keep it</Button>
        </div>
      ) : null}
    </li>
  );
}

function RecordCharge({ shipment, onDone }: { shipment: ShipmentDetail; onDone: () => Promise<void> }) {
  const empty = { type: "duty", description: "", amount: "", currency: shipment.total.currency, assessedBy: "", reference: "" };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof empty, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const currency = v.currency.trim().toUpperCase();

  function review(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<keyof typeof empty, string>> = {};
    if (v.description.trim() === "") found.description = "Say what the charge is for.";
    if (!/^[A-Za-z]{3}$/.test(v.currency.trim())) found.currency = "Use the three-letter currency code, for example USD.";
    const minor = toMinor(v.amount, currencyDecimals(currency));
    if (v.amount.trim() === "") found.amount = "Enter the amount customs assessed.";
    else if (minor === null) found.amount = `Enter an amount with at most ${currencyDecimals(currency)} decimal places.`;
    else if (minor < BigInt(1)) found.amount = "The amount must be more than zero.";
    if (v.assessedBy.trim() === "") found.assessedBy = "Say which authority assessed it.";
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function record() {
    setPending(true);
    setError(null);

    try {
      await recordCustomsCharge(shipment.id, { type: v.type, description: v.description.trim(), amount: v.amount.trim(), currency, assessed_by: v.assessedBy.trim(), ...(v.reference.trim() ? { authority_reference: v.reference.trim() } : {}) });
      setV(empty);
      await onDone();
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) setErrors({ amount: caught.field("amount"), currency: caught.field("currency"), description: caught.field("description"), assessedBy: caught.field("assessed_by") });
      setError(describeError(caught));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <form onSubmit={review} noValidate aria-label="Record a charge" className="mt-4 space-y-3 border-t border-foreground/10 pt-4">
      <h3 className="font-semibold">Record a charge customs assessed</h3>
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Type" value={v.type} onChange={set("type")} disabled={confirming}>{Object.entries(CHARGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <TextField label="What it is for" value={v.description} onChange={set("description")} error={errors.description} maxLength={200} disabled={confirming} />
        <TextField label="Amount" inputMode="decimal" value={v.amount} onChange={set("amount")} error={errors.amount} disabled={confirming} />
        <TextField label="Currency" value={v.currency} onChange={set("currency")} error={errors.currency} maxLength={3} disabled={confirming} />
        <TextField label="Assessed by" value={v.assessedBy} onChange={set("assessedBy")} error={errors.assessedBy} maxLength={160} disabled={confirming} hint="For example the customs authority's name." />
        <TextField label="Authority reference (optional)" value={v.reference} onChange={set("reference")} maxLength={120} disabled={confirming} />
      </div>
      {confirming ? (
        <div role="group" aria-label="Confirm charge" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>Add a {formatMinorAmount(Number(toMinor(v.amount, currencyDecimals(currency))), currency)} {CHARGE_TYPE_LABELS[v.type]?.toLowerCase()} charge? The customer can see it, and it can&apos;t be edited afterwards.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={record}>{pending ? "Saving…" : "Yes, add the charge"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : <Button type="submit" variant="outline">Review charge</Button>}
    </form>
  );
}

/** The paperwork and money side of a cross-border shipment, for people who manage customs. */
export function CustomsPanel({ shipment, onDone }: { shipment: ShipmentDetail; onDone: () => Promise<void> }) {
  const client = useQueryClient();
  const overview = useQuery({ queryKey: ["admin-customs", shipment.id], queryFn: ({ signal }) => fetchCustomsOverview(shipment.id, signal), retry: false });
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin-customs", shipment.id] }), onDone()]); };

  if (overview.isPending) return <p role="status">Loading customs details…</p>;
  if (overview.isError) return <AdminProblem error={overview.error} what="the customs details" onRetry={() => void overview.refetch()} />;

  const o = overview.data;
  if (!o.international) return null;
  const d = o.declaration;

  return (
    <section aria-labelledby="customs-heading" className="space-y-4 rounded-md border border-foreground/20 p-4">
      <h2 id="customs-heading" className="text-lg font-semibold">Customs</h2>
      <p className="text-sm">{d ? <>Declaration: {d.incoterm ?? "—"}, exporting for {d.reason_for_export?.replace(/_/g, " ") ?? "—"}{d.eori_number ? ` · EORI ${d.eori_number}` : ""}{d.exporter_tax_id ? ` · exporter tax ID ${d.exporter_tax_id}` : ""}{d.consignee_tax_id ? ` · consignee tax ID ${d.consignee_tax_id}` : ""}{d.remarks ? ` · ${d.remarks}` : ""}.</> : "The customer hasn't made a customs declaration yet."}</p>

      <div>
        <h3 className="font-semibold">Documents</h3>
        {o.requirements.length === 0 ? <p className="text-sm opacity-80">No documents are required for this route.</p> : (
          <ul aria-label="Required documents" className="mt-1 space-y-1 text-sm">
            {o.requirements.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2"><StatusChip label={r.status === "satisfied" ? "On file" : "Missing"} tone={r.status === "satisfied" ? "good" : r.mandatory ? "bad" : "plain"} /><span>{DOCUMENT_LABELS[r.document_type] ?? r.label}{r.direction === "export" ? " (leaving the country)" : " (arriving)"}{r.mandatory ? "" : " · optional"}</span>{r.status === "missing" && r.reason ? <span className="opacity-75">— {r.reason}</span> : null}</li>
            ))}
          </ul>
        )}
        <p className={o.ready_for_export ? "mt-2 text-sm text-green-900" : "mt-2 text-sm font-medium text-red-900"}>{o.ready_for_export ? "Every document needed before this shipment leaves the country is on file." : "Departure is held until the mandatory export documents are on file."}</p>
      </div>

      <div>
        <h3 className="font-semibold">Duties and taxes</h3>
        {o.estimates.items.length > 0 ? <p className="text-sm">Estimated at booking: {o.estimates.items.map((e) => `${e.label} ${formatMinorAmount(e.amount_minor, e.currency)}`).join(", ")}. <span className="opacity-75">Estimates only; they are not charges.</span></p> : null}
        <FormAlert message={error} />
        {o.assessed_charges.items.length === 0 ? <p className="mt-1 text-sm opacity-80">Customs hasn&apos;t assessed any charges.</p> : (
          <ul aria-label="Assessed charges" className="mt-2 space-y-2">
            {o.assessed_charges.items.map((c) => <ChargeRow key={c.id} charge={c} onDone={refresh} onError={setError} />)}
          </ul>
        )}
        <RecordCharge shipment={shipment} onDone={refresh} />
      </div>
    </section>
  );
}
