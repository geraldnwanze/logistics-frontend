"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pager, StatusChip } from "@/components/ui/pager";
import { downloadInvoice } from "@/lib/shipping/download";
import { fetchInvoices } from "@/lib/shipping/api";
import { formatDate, formatMoney, invoiceLabel } from "@/lib/shipping/format";
import type { Invoice } from "@/lib/shipping/schemas";
import { parsePage } from "./shipments-list";

const hrefFor = (page: number) => `/account/invoices${page > 1 ? `?page=${page}` : ""}`;

export function InvoicesList() {
  const page = parsePage(useSearchParams().get("page"));
  const list = useQuery({ queryKey: ["invoices", page], queryFn: ({ signal }) => fetchInvoices(page, signal), placeholderData: keepPreviousData, retry: false });
  const router = useRouter();

  if (list.isPending) return <p role="status">Loading your invoices…</p>;

  if (list.isError) {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>We couldn&apos;t load your invoices right now.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>
      </div>
    );
  }

  if (list.data.items.length === 0) {
    return page > 1 ? (
      <div role="status"><p>There are no invoices on this page.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => router.push(hrefFor(1))}>Back to the first page</Button></div>
    ) : (
      <div role="status" className="rounded-md border border-foreground/20 p-6 text-center">
        <p className="text-lg font-medium">No invoices yet.</p>
        <p className="mt-1 text-sm opacity-80">An invoice is created when you book a shipment.</p>
        <Link href="/quote" className={buttonVariants({ className: "mt-3" })}>Get a quote</Link>
      </div>
    );
  }

  return (
    <div aria-busy={list.isFetching}>
      <ul className="space-y-3">
        {list.data.items.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}
      </ul>
      <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={hrefFor} />
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const label = invoiceLabel(invoice);
  const paid = invoice.status === "paid" || invoice.refunded.amount_minor > 0;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setDownloadError(await downloadInvoice(invoice.id));
    setBusy(false);
  }

  return (
    <li className="rounded-md border border-foreground/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-lg font-semibold">{invoice.number}</p>
          <p className="text-sm opacity-80">
            Issued {formatDate(invoice.issued_at)}
            {invoice.paid_at ? ` · paid ${formatDate(invoice.paid_at)}` : invoice.due_at ? ` · due ${formatDate(invoice.due_at)}` : ""}
          </p>
          {invoice.tracking_number && invoice.shipment_id ? (
            <p className="text-sm">Shipment <Link href={`/shipments/${encodeURIComponent(invoice.shipment_id)}`} className="font-mono underline">{invoice.tracking_number}</Link></p>
          ) : null}
        </div>
        <div className="text-right">
          <StatusChip label={label.text} tone={label.tone} />
          <p className="mt-1 font-semibold">{formatMoney(invoice.total)}</p>
          {invoice.refunded.amount_minor > 0 ? <p className="text-sm">Refunded {formatMoney(invoice.refunded)}</p> : null}
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">Details</summary>
        <table className="mt-2 w-full">
          <caption className="sr-only">Lines on invoice {invoice.number}</caption>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i} className="border-t border-foreground/10"><th scope="row" className="py-1 text-left font-normal">{item.description}</th><td className="py-1 text-right">{formatMoney(item.amount)}</td></tr>
            ))}
            {invoice.tax.amount_minor > 0 ? <tr className="border-t border-foreground/10"><th scope="row" className="py-1 text-left font-normal">Tax</th><td className="py-1 text-right">{formatMoney(invoice.tax)}</td></tr> : null}
            <tr className="border-t border-foreground/30 font-semibold"><th scope="row" className="py-1 text-left">Total</th><td className="py-1 text-right">{formatMoney(invoice.total)}</td></tr>
          </tbody>
        </table>
        {invoice.billing_name ? <p className="mt-2 opacity-80">Billed to {invoice.billing_name}</p> : null}
        {invoice.credit_notes.length > 0 ? (
          <ul className="mt-2 list-disc pl-5">
            {invoice.credit_notes.map((note) => <li key={note.number}>Credit note {note.number}: {formatMoney(note.amount)} on {formatDate(note.issued_at)}</li>)}
          </ul>
        ) : null}
      </details>

      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={download} disabled={busy}>{busy ? "Preparing…" : paid ? "Download receipt (PDF)" : "Download invoice (PDF)"}</Button>
        {downloadError ? <p role="alert" className="mt-2 text-sm text-red-900">{downloadError}</p> : null}
      </div>
    </li>
  );
}
