"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { fetchShipment, startPayment } from "@/lib/shipping/api";
import { downloadInvoice } from "@/lib/shipping/download";
import { formatDays, formatMoney, statusTone } from "@/lib/shipping/format";
import type { Shipment } from "@/lib/shipping/schemas";
import { StatusChip } from "@/components/ui/pager";
import { CancelPanel } from "./cancel-panel";
import { paymentDestination } from "./payment-redirect";

const WAIT_FOR_CONFIRMATION_MS = 60_000;

function addressLines(p: NonNullable<Shipment["sender"]>): string {
  return [p.name, p.company, p.line1, p.line2, [p.city, p.state, p.postal_code].filter(Boolean).join(" "), p.country].filter(Boolean).join(", ");
}

export function paymentLabel(shipment: Shipment): { text: string; tone: "ok" | "warn" | "plain" } {
  if (shipment.payment.requires_payment) return { text: "Payment needed", tone: "warn" };
  if (shipment.payment.status === "paid") return { text: "Paid", tone: "ok" };
  if (shipment.payment.method === "invoice") return { text: "On account (invoiced)", tone: "plain" };

  return { text: shipment.payment.status ? shipment.payment.status.replace(/_/g, " ") : "—", tone: "plain" };
}

export function ShipmentView({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const returned = params.get("returned") === "1";
  const paymentFailed = params.get("payment") === "error";
  const [actionError, setActionError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  useEffect(() => {
    if (!returned) return;
    const timer = setTimeout(() => setGaveUp(true), WAIT_FOR_CONFIRMATION_MS);

    return () => clearTimeout(timer);
  }, [returned]);

  const shipment = useQuery({
    queryKey: ["shipment", id],
    queryFn: ({ signal }) => fetchShipment(id, signal),
    retry: false,
    // Coming back from the payment page, the provider's confirmation arrives a moment later, so look again for a while.
    refetchInterval: (query) => (returned && !gaveUp && query.state.data?.payment.requires_payment ? 3000 : false),
  });

  if (shipment.isPending) return <p role="status">Loading your shipment…</p>;

  if (shipment.isError) {
    const missing = shipment.error instanceof ApiError && shipment.error.status === 404;

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this shipment. If you booked as a guest, open this page in the same browser tab you booked in, or track it with your tracking number." : "We couldn't load this shipment right now."}</p>
        <div className="mt-3 flex gap-2">
          {missing ? <Link href="/track" className={buttonVariants({ size: "sm" })}>Track a shipment</Link> : <Button size="sm" variant="outline" onClick={() => void shipment.refetch()}>Try again</Button>}
        </div>
      </div>
    );
  }

  const s = shipment.data;
  const payment = paymentLabel(s);
  const waiting = returned && !gaveUp && s.payment.requires_payment;
  const stillUnconfirmed = returned && gaveUp && s.payment.requires_payment && !paymentFailed;

  async function payNow() {
    setPaying(true);
    setActionError(null);

    try {
      const started = await startPayment(id, globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}`);
      const destination = paymentDestination(started.action?.url ?? null, id, window.location.origin);

      if (destination.kind === "external") window.location.assign(destination.url);
      else if (destination.path.startsWith("/sandbox-pay")) router.push(destination.path);
      else setActionError("We couldn't start the payment. Please try again.");
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setPaying(false);
    }
  }

  async function downloadDocument() {
    if (!s.payment.invoice_id) return;
    setInvoiceBusy(true);
    setActionError(await downloadInvoice(s.payment.invoice_id, id));
    setInvoiceBusy(false);
  }

  const cancelled = s.status === "cancelled";
  const refunded = s.payment.refunded;

  return (
    <div className="space-y-8">
      {cancelled ? (
        <div role="status" className="rounded-md border border-red-700/30 bg-red-50 p-4 text-red-950">
          <p className="font-semibold">This booking was cancelled{s.cancelled_at ? ` on ${new Date(s.cancelled_at).toLocaleDateString()}` : ""}.</p>
          {s.cancellation_reason ? <p className="text-sm">Reason: {s.cancellation_reason}</p> : null}
          {refunded && refunded.amount_minor > 0 ? <p className="mt-1 text-sm">Refunded: <strong>{formatMoney(refunded)}</strong> to your original payment method. Refunds can take a few days to appear.</p> : <p className="mt-1 text-sm">You were not charged.</p>}
        </div>
      ) : null}
      {s.payment.status === "paid" && returned ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-green-900">Payment received. Your shipment is confirmed.</p> : null}
      {waiting ? <p role="status" className="rounded-md border border-foreground/20 p-3">Waiting for your payment to be confirmed…</p> : null}
      {stillUnconfirmed ? <p role="status" className="rounded-md border border-amber-600/50 bg-amber-50 p-3 text-amber-950">We haven&apos;t received confirmation of your payment yet. It can take a few minutes; refresh this page shortly. If you were not charged you can pay again below.</p> : null}
      {paymentFailed ? <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 p-3 text-red-900">Your booking is saved, but we couldn&apos;t start the payment. You can try again below.</p> : null}
      <FormAlert message={actionError} />
      {s.is_demo ? <p className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-950">Demonstration shipment: sample data, no real parcel will move.</p> : null}

      <section aria-labelledby="tracking-heading" className="rounded-md border border-foreground/20 p-5">
        <p className="text-sm opacity-80">Tracking number</p>
        <p id="tracking-heading" className="break-all font-mono text-2xl font-semibold">{s.tracking_number}</p>
        <p className="mt-2 flex items-center gap-2">Status: <StatusChip label={s.status_label} tone={statusTone(s.status)} /></p>
        <p className="text-sm opacity-80">{s.service.name} · delivery in {formatDays(s.estimated_delivery)} (estimate)</p>
        <Link href={`/track/${encodeURIComponent(s.tracking_number)}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>Track this shipment</Link>
      </section>

      <section aria-labelledby="payment-heading" className="rounded-md border border-foreground/20 p-5">
        <h2 id="payment-heading" className="text-xl font-semibold">Payment</h2>
        <p className="mt-1">Total {formatMoney(s.total)}{s.payment.invoice_number ? ` · invoice ${s.payment.invoice_number}` : ""}</p>
        <p className={payment.tone === "warn" ? "font-semibold text-amber-800" : payment.tone === "ok" ? "font-semibold text-green-800" : ""}>{payment.text}</p>
        {s.payment.invoice_id ? <Button className="mt-3 mr-2" variant="outline" size="sm" onClick={downloadDocument} disabled={invoiceBusy}>{invoiceBusy ? "Preparing…" : s.payment.status === "paid" ? "Download receipt (PDF)" : "Download invoice (PDF)"}</Button> : null}
        {s.payment.requires_payment ? <Button className="mt-3" onClick={payNow} disabled={paying}>{paying ? "Starting payment…" : `Pay ${formatMoney(s.total)}`}</Button> : null}
      </section>

      {s.sender && s.recipient && s.sender.country !== s.recipient.country && !cancelled ? (
        <section aria-labelledby="customs-heading" className="rounded-md border border-foreground/20 p-5">
          <h2 id="customs-heading" className="text-xl font-semibold">Customs and documents</h2>
          <p className="mt-1 text-sm opacity-80">This shipment crosses a border. Tell customs what it is and provide any documents they need so it isn&apos;t held up.</p>
          <Link href={`/shipments/${encodeURIComponent(id)}/customs`} className={buttonVariants({ className: "mt-3" })}>Complete customs details</Link>
        </section>
      ) : null}

      <section aria-labelledby="help-heading" className="rounded-md border border-foreground/20 p-5">
        <h2 id="help-heading" className="text-xl font-semibold">Need help with this shipment?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/support?shipment=${encodeURIComponent(s.tracking_number)}&ref=${encodeURIComponent(id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Contact support</Link>
          {["booking_pending", "booking_confirmed", "cancelled"].includes(s.status) ? null : <Link href={`/shipments/${encodeURIComponent(id)}/claim`} className={buttonVariants({ variant: "outline", size: "sm" })}>Make a claim</Link>}
        </div>
      </section>

      {s.cancellable && !cancelled ? <CancelPanel shipment={s} /> : null}

      <section aria-labelledby="route-heading">
        <h2 id="route-heading" className="text-xl font-semibold">Addresses</h2>
        <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
          {s.sender ? <div><dt className="opacity-70">From</dt><dd>{addressLines(s.sender)}</dd></div> : null}
          {s.recipient ? <div><dt className="opacity-70">To</dt><dd>{addressLines(s.recipient)}</dd></div> : null}
        </dl>
      </section>

      <section aria-labelledby="items-heading">
        <h2 id="items-heading" className="text-xl font-semibold">Contents</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {s.items.map((item, i) => <li key={i}>{item.quantity} × {item.description}</li>)}
        </ul>
        {s.required_documents.length > 0 ? <p className="mt-3 text-sm">Documents you may need to provide: {s.required_documents.join(", ")}.</p> : null}
      </section>
    </div>
  );
}
