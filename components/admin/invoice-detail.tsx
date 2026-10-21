"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { fetchInvoice, formatMinorAmount, recordOfflinePayment, type InvoiceDetail } from "@/lib/admin/finance";
import { ATTEMPT_STATUS_LABELS, attemptTone, can, INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, invoiceTone, LEDGER_TYPE_LABELS } from "@/lib/admin/labels";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";
import { formatDate } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";
import { FinanceTabs } from "./finance-tabs";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Money that arrived another way (bank transfer, cheque) for an invoice on account. The whole total, once; the ledger entry cannot be edited afterwards. */
function RecordPayment({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => Promise<void> }) {
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ for: string; value: string }>({ for: "", value: "" });
  const amount = formatMinorAmount(invoice.total_minor, invoice.currency);

  async function record() {
    if (key.current.for !== reference.trim()) key.current = { for: reference.trim(), value: crypto.randomUUID() };
    setPending(true);
    setError(null);

    try {
      await recordOfflinePayment(invoice.id, reference.trim(), key.current.value);
      setReference("");
      await onDone();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "payment_not_recordable" ? "This invoice has already been paid or isn't on account, so a payment can't be recorded. The page now shows its current state." : describeError(caught));
      if (caught instanceof ApiError && caught.code === "payment_not_recordable") await onDone();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby="record-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="record-heading" className="text-lg font-semibold">Record a payment</h2>
      <p className="mt-1 text-sm">Use this when the customer paid {amount} another way, such as a bank transfer. It marks the invoice paid and adds an entry to the ledger that can&apos;t be edited later.</p>
      <FormAlert message={error} />
      <form onSubmit={(e) => { e.preventDefault(); if (reference.trim() !== "") setConfirming(true); }} aria-label="Record a payment" className="mt-3 space-y-3">
        <TextField label="Payment reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} disabled={confirming} hint="For example the bank transfer reference or cheque number." />
        {confirming ? (
          <div role="group" aria-label="Confirm payment" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
            <span>Record {amount} received as “{reference.trim()}”? This can&apos;t be undone.</span>
            <Button type="button" className="min-h-11" disabled={pending} onClick={record}>{pending ? "Recording…" : "Yes, record it"}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
          </div>
        ) : (
          <Button type="submit" variant="outline" disabled={reference.trim() === ""}>Review payment</Button>
        )}
      </form>
    </section>
  );
}

export function InvoiceDetailView({ id, user }: { id: string; user: User }) {
  const client = useQueryClient();
  const invoice = useQuery({ queryKey: ["admin-invoice", id], queryFn: ({ signal }) => fetchInvoice(id, signal), retry: false, refetchInterval: 60_000 });

  if (invoice.isPending) return <p role="status">Loading the invoice…</p>;
  if (invoice.isError) return <AdminProblem error={invoice.error} what="this invoice" onRetry={() => void invoice.refetch()} />;

  const i = invoice.data;
  const money = (minor: number) => formatMinorAmount(minor, i.currency);
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin-invoice", id] }), client.invalidateQueries({ queryKey: ["admin-invoices"] })]); };

  return (
    <div className="space-y-8">
      <p><Link href="/admin/finance/invoices" className="text-sm underline">← All invoices</Link></p>
      <FinanceTabs current="/admin/finance/invoices" />
      <header>
        <h1 className="font-mono text-2xl font-semibold">{i.number}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={INVOICE_STATUS_LABELS[i.status] ?? i.status} tone={invoiceTone(i.status, i.overdue)} />
          {i.overdue ? <StatusChip label="Overdue" tone="bad" /> : null}
          <span>{INVOICE_KIND_LABELS[i.kind] ?? i.kind}{i.billing_name ? ` · ${i.billing_name}` : ""}</span>
          {i.shipment_id && i.tracking_number && can(user, "shipments.view") ? <Link href={`/admin/shipments/${encodeURIComponent(i.shipment_id)}`} className="font-mono underline">{i.tracking_number}</Link> : i.tracking_number ? <span className="font-mono">{i.tracking_number}</span> : null}
        </p>
        <p className="mt-1 text-sm opacity-80">Issued {formatDate(i.issued_at)}{i.due_at ? ` · due ${formatDate(i.due_at)}` : ""}{i.paid_at ? ` · paid ${formatDate(i.paid_at)}` : ""}</p>
      </header>

      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="text-lg font-semibold">What it covers</h2>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead><tr className="border-b border-foreground/20 text-left"><th scope="col" className="py-1 pr-2 font-medium">Line</th><th scope="col" className="py-1 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {i.items.map((line, n) => <tr key={n} className="border-b border-foreground/10"><td className="py-1 pr-2">{line.description}</td><td className="py-1 text-right">{money(line.amount_minor)}</td></tr>)}
            <tr><th scope="row" className="py-1 pr-2 text-left font-semibold">Total</th><td className="py-1 text-right font-semibold">{money(i.total_minor)}</td></tr>
            {i.refunded_minor > 0 ? <tr><th scope="row" className="py-1 pr-2 text-left">Refunded</th><td className="py-1 text-right">{money(i.refunded_minor)}</td></tr> : null}
          </tbody>
        </table>
      </section>

      {i.payment_attempts.length > 0 ? (
        <section aria-labelledby="attempts-heading">
          <h2 id="attempts-heading" className="text-lg font-semibold">Payment attempts</h2>
          <ul className="mt-2 space-y-2">
            {i.payment_attempts.map((a) => (
              <li key={a.id} className="rounded-md border border-foreground/20 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2"><StatusChip label={ATTEMPT_STATUS_LABELS[a.status] ?? a.status} tone={attemptTone(a.status)} />{a.duplicate ? <StatusChip label="Duplicate payment" tone="bad" /> : null}<span>{money(a.amount_minor)} via {a.provider}</span></p>
                {a.reference ? <p className="font-mono text-xs opacity-75">{a.reference}</p> : null}
                {a.failure_code ? <p>Failed: {a.failure_code.replace(/_/g, " ")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="text-lg font-semibold">Ledger</h2>
        {i.ledger.length === 0 ? <p className="mt-2 text-sm opacity-75">No money has moved on this invoice.</p> : (
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Ledger entries, oldest first</caption>
            <thead><tr className="border-b border-foreground/20 text-left"><th scope="col" className="py-1 pr-2 font-medium">When</th><th scope="col" className="py-1 pr-2 font-medium">What</th><th scope="col" className="py-1 pr-2 font-medium">Reference</th><th scope="col" className="py-1 text-right font-medium">Amount</th></tr></thead>
            <tbody>
              {i.ledger.map((t, n) => (
                <tr key={n} className="border-b border-foreground/10">
                  <td className="py-1 pr-2">{when(t.occurred_at)}</td>
                  <td className="py-1 pr-2">{LEDGER_TYPE_LABELS[t.type] ?? t.type}{t.metadata && !Array.isArray(t.metadata) && t.metadata.method === "offline" ? " (recorded by hand)" : ""}</td>
                  <td className="break-all py-1 pr-2 font-mono text-xs">{t.reference ?? "—"}</td>
                  <td className="py-1 text-right">{t.type === "refund" ? `−${money(t.amount_minor)}` : money(t.amount_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {i.credit_notes.length > 0 ? <p className="mt-2 text-sm">Credit notes: {i.credit_notes.map((c) => `${c.number} (${money(c.amount_minor)})`).join(", ")}</p> : null}
      </section>

      {can(user, "payments.record") && i.kind === "invoiced" && i.status === "issued" ? <RecordPayment invoice={i} onDone={refresh} /> : null}
    </div>
  );
}
