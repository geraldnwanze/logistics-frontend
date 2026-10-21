"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { cancelShipment } from "@/lib/shipping/api";
import { formatMoney } from "@/lib/shipping/format";
import type { Shipment } from "@/lib/shipping/schemas";

/** What cancelling will do to the money, said before the customer commits. */
export function cancellationConsequence(shipment: Shipment): string {
  if (shipment.payment.method === "prepaid" && shipment.payment.status === "paid") return `You've paid ${formatMoney(shipment.total)}. It will be refunded in full to your original payment method.`;
  if (shipment.payment.method === "invoice") return "Your invoice will be cancelled. Nothing will be charged.";

  return "You haven't paid yet, so nothing will be charged and the invoice will be cancelled.";
}

export function CancelPanel({ shipment }: { shipment: Shipment }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const updated = await cancelShipment(shipment.id, reason);
      client.setQueryData(["shipment", shipment.id], updated);
      await client.invalidateQueries({ queryKey: ["shipments"] });
      await client.invalidateQueries({ queryKey: ["invoices"] });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "shipment_collected") {
        setError("This shipment has already been collected, so it can no longer be cancelled here. Please contact support.");
        await client.invalidateQueries({ queryKey: ["shipment", shipment.id] });
      } else {
        setError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <section aria-labelledby="cancel-heading">
        <h2 id="cancel-heading" className="sr-only">Cancel booking</h2>
        <Button variant="outline" onClick={() => setOpen(true)}>Cancel this booking</Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="cancel-heading" className="rounded-md border border-red-700/30 p-5">
      <h2 id="cancel-heading" className="text-xl font-semibold">Cancel this booking?</h2>
      <p className="mt-2 text-sm">{cancellationConsequence(shipment)}</p>
      <p className="mt-1 text-sm opacity-80">This can&apos;t be undone. Once your shipment has been collected it can no longer be cancelled.</p>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <FormAlert message={error} />
        <div>
          <label htmlFor="cancel-reason" className="mb-1 block text-sm font-medium">Reason (optional)</label>
          <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} rows={3} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          <p className="mt-1 text-xs opacity-75">{reason.length}/250</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={pending}>{pending ? "Cancelling…" : "Yes, cancel booking"}</Button>
          <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={pending}>Keep my booking</Button>
        </div>
      </form>
    </section>
  );
}
