"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { cancelShipmentAsStaff, refundShipment, uploadDeliveryProof, type ShipmentDetail } from "@/lib/admin/shipments";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { uploadProblem } from "@/lib/shipping/customs-labels";
import { decimalPlaces, formatMinor, toMinor } from "@/lib/shipping/money";

const REFUND_ERRORS: Record<string, string> = {
  nothing_to_refund: "This invoice hasn't been paid, so there is nothing to refund.",
  no_payment_to_refund: "There is no online payment on this invoice to refund against. Record the repayment another way.",
  refund_failed: "The payment provider couldn't process the refund. Nothing was changed; you can try again.",
};

/** Cancelling is only possible before collection. A paid, prepaid booking is refunded in full first, so the confirmation says so. */
export function CancelPanel({ shipment, onDone }: { shipment: ShipmentDetail; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decimals = decimalPlaces(shipment.total.amount);
  const refundable = shipment.invoice?.refundable_minor ?? 0;
  const willRefund = refundable > 0;

  async function cancel() {
    setPending(true);
    setError(null);

    try {
      await cancelShipmentAsStaff(shipment.id, reason.trim());
      setReason("");
      setConfirming(false);
      await onDone();
    } catch (caught) {
      setConfirming(false);
      if (caught instanceof ApiError && caught.code === "shipment_collected") await onDone();   // it has moved on; show the page as it now is
      setError(caught instanceof ApiError && (caught.code === "shipment_collected" || REFUND_ERRORS[caught.code]) ? (REFUND_ERRORS[caught.code] ?? caught.message) : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() !== "") setConfirming(true);
  }

  return (
    <section aria-labelledby="cancel-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="cancel-heading" className="text-lg font-semibold">Cancel this shipment</h2>
      <p className="mt-1 text-sm">It hasn&apos;t been collected yet, so it can still be cancelled. {willRefund ? `The customer is refunded ${formatMinor(BigInt(refundable), decimals, shipment.total.currency)} to their original payment method.` : "No payment needs refunding."}</p>
      <FormAlert message={error} />
      <form onSubmit={review} className="mt-3 space-y-3" aria-label="Cancel shipment">
        <div>
          <label htmlFor="cancel-reason" className="mb-1 block text-sm font-medium">Reason (the customer will see this)</label>
          <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={250} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        </div>
        {confirming ? (
          <div role="group" aria-label="Confirm cancellation" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
            <span>Cancel this shipment{willRefund ? ` and refund ${formatMinor(BigInt(refundable), decimals, shipment.total.currency)}` : ""}? This can&apos;t be undone.</span>
            <Button type="button" className="min-h-11" disabled={pending} onClick={cancel}>{pending ? "Cancelling…" : "Yes, cancel it"}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Keep it</Button>
          </div>
        ) : (
          <Button type="submit" variant="outline" disabled={reason.trim() === ""}>Review cancellation</Button>
        )}
      </form>
    </section>
  );
}

/** A refund for part or all of what is still refundable. The key is kept for the same attempt, so a retry after a dropped connection cannot refund twice. */
export function RefundPanel({ shipment, onDone }: { shipment: ShipmentDetail; onDone: () => Promise<void> }) {
  const invoice = shipment.invoice!;
  const decimals = decimalPlaces(shipment.total.amount);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<{ for: string; value: string }>({ for: "", value: "" });
  const money = (minor: number) => formatMinor(BigInt(minor), decimals, shipment.total.currency);
  const minor = amount.trim() === "" ? BigInt(invoice.refundable_minor) : toMinor(amount, decimals);
  const amountError = amount.trim() === "" ? null : minor === null ? `Enter an amount with at most ${decimals} decimal places.` : minor < BigInt(1) ? "The amount must be more than zero." : minor > BigInt(invoice.refundable_minor) ? `At most ${money(invoice.refundable_minor)} can still be refunded.` : null;
  const invalid = reason.trim() === "" || amountError !== null || minor === null;

  async function refund() {
    const signature = `${amount.trim()}|${reason.trim()}`;
    if (key.current.for !== signature) key.current = { for: signature, value: crypto.randomUUID() };
    setPending(true);
    setError(null);
    setDone(null);

    try {
      await refundShipment(shipment.id, { ...(amount.trim() ? { amount: amount.trim() } : {}), reason: reason.trim() }, key.current.value);
      setDone(`Refunded ${money(Number(minor))}.`);
      setAmount("");
      setReason("");
      await onDone();
    } catch (caught) {
      setError(caught instanceof ApiError && REFUND_ERRORS[caught.code] ? REFUND_ERRORS[caught.code] : caught instanceof ApiError && caught.code === "refund_exceeds_balance" ? caught.message : describeError(caught));
      if (caught instanceof ApiError && caught.code === "refund_exceeds_balance") await onDone();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby="refund-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="refund-heading" className="text-lg font-semibold">Refund</h2>
      <p className="mt-1 text-sm">Paid {money(invoice.total_minor)}; already refunded {money(invoice.refunded_minor)}; still refundable {money(invoice.refundable_minor)}.</p>
      <FormAlert message={error} />
      {done ? <p role="status" className="mt-2 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{done}</p> : null}
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) setConfirming(true); }} aria-label="Refund" className="mt-3 space-y-3">
        <TextField label={`Amount (${shipment.total.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountError} disabled={confirming} hint="Leave blank to refund everything still refundable." />
        <div>
          <label htmlFor="refund-reason" className="mb-1 block text-sm font-medium">Reason</label>
          <textarea id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={250} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        </div>
        {confirming ? (
          <div role="group" aria-label="Confirm refund" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
            <span>Refund {money(Number(minor))} to the customer&apos;s original payment method? Money moves once; this can&apos;t be undone.</span>
            <Button type="button" className="min-h-11" disabled={pending} onClick={refund}>{pending ? "Refunding…" : "Yes, refund"}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
          </div>
        ) : (
          <Button type="submit" variant="outline" disabled={invalid}>Review refund</Button>
        )}
      </form>
    </section>
  );
}

/** Attaches a photo or scan to a delivery event. Checked here first; the server inspects the real file. */
export function ProofUpload({ shipmentId, eventId, onDone }: { shipmentId: string; eventId: string; onDone: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    const problem = uploadProblem(file);
    if (problem) return setMessage({ tone: "bad", text: `“${file.name}”: ${problem}` });

    setPending(true);
    setMessage(null);

    try {
      await uploadDeliveryProof(shipmentId, eventId, file);
      await onDone();
      setMessage({ tone: "good", text: `${file.name} was attached.` });
    } catch (caught) {
      setMessage({ tone: "bad", text: caught instanceof ApiError && ["unsupported_media_type", "too_many_documents"].includes(caught.code) ? caught.message : describeError(caught) });
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="mt-2">
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label="Choose proof of delivery file" data-testid="proof-input" onChange={(e) => void choose(e.target.files?.[0])} />
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={() => input.current?.click()}>{pending ? "Uploading…" : "Attach proof of delivery"}</Button>
      {message ? <p role={message.tone === "bad" ? "alert" : "status"} className={message.tone === "bad" ? "mt-1 text-sm text-red-900" : "mt-1 text-sm text-green-900"}>{message.text}</p> : null}
    </div>
  );
}
