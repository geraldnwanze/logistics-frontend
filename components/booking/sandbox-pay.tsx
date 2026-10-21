"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { simulateSandboxPayment } from "@/lib/shipping/api";

/**
 * Stands in for a payment provider's checkout page while only the sandbox gateway exists. It says so plainly,
 * and it only works where the API's sandbox route exists (never in production).
 */
export function SandboxPay() {
  const router = useRouter();
  const params = useSearchParams();
  const reference = params.get("reference") ?? "";
  const shipment = params.get("shipment") ?? "";
  const [pending, setPending] = useState<"succeeded" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[\w-]{6,100}$/.test(reference) && /^[\w-]{10,40}$/.test(shipment);

  if (!valid) return <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 p-4 text-red-900">This payment link is incomplete.</p>;

  async function finish(outcome: "succeeded" | "failed") {
    setPending(outcome);
    setError(null);

    try {
      await simulateSandboxPayment(reference, outcome);
      router.push(`/shipments/${encodeURIComponent(shipment)}?returned=1${outcome === "failed" ? "&payment=error" : ""}`);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 404 ? "Sandbox payments aren't available on this site." : describeError(caught));
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <p role="note" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950"><strong>Sandbox payment.</strong> This is a practice checkout. No card is charged and no real money moves.</p>
      <FormAlert message={error} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => finish("succeeded")} disabled={pending !== null}>{pending === "succeeded" ? "Paying…" : "Pay (simulate success)"}</Button>
        <Button variant="outline" onClick={() => finish("failed")} disabled={pending !== null}>{pending === "failed" ? "Declining…" : "Decline (simulate failure)"}</Button>
      </div>
    </div>
  );
}
