"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchInvoices, formatMinorAmount, type InvoiceFilters } from "@/lib/admin/finance";
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, invoiceTone } from "@/lib/admin/labels";
import { formatDate } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";
import { FinanceTabs } from "./finance-tabs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function invoiceFiltersFrom(params: URLSearchParams): InvoiceFilters {
  const status = params.get("status") ?? "";
  const kind = params.get("kind") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  return {
    status: status in INVOICE_STATUS_LABELS ? status : undefined, kind: kind in INVOICE_KIND_LABELS ? kind : undefined, overdue: params.get("overdue") === "1" || undefined,
    q: params.get("q")?.trim().slice(0, 30) || undefined, from: DATE.test(from) ? from : undefined, to: DATE.test(to) && (!DATE.test(from) || to >= from) ? to : undefined, page: parsePage(params.get("page")),
  };
}

export function invoicesHref(filters: InvoiceFilters, page = 1): string {
  const search = new URLSearchParams();
  const entries: [string, string | undefined][] = [["status", filters.status], ["kind", filters.kind], ["overdue", filters.overdue ? "1" : undefined], ["q", filters.q], ["from", filters.from], ["to", filters.to], ["page", page > 1 ? String(page) : undefined]];
  for (const [key, value] of entries) if (value) search.set(key, value);
  const text = search.toString();

  return `/admin/finance/invoices${text ? `?${text}` : ""}`;
}

export function InvoicesQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const filters = invoiceFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const [search, setSearch] = useState(filters.q ?? "");
  const list = useQuery({ queryKey: ["admin-invoices", filters], queryFn: ({ signal }) => fetchInvoices(filters, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });
  const go = (change: Partial<InvoiceFilters>) => router.replace(invoicesHref({ ...filters, ...change, page: undefined }));
  const anyFilter = Boolean(filters.status || filters.kind || filters.overdue || filters.q || filters.from || filters.to);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Finance</h1>
      <div className="mt-4"><FinanceTabs current="/admin/finance/invoices" /></div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go({ q: search.trim() || undefined }); }} role="search" aria-label="Filter invoices" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Status" value={filters.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">Any status</option>
          {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="Type" value={filters.kind ?? ""} onChange={(e) => go({ kind: e.target.value || undefined })}>
          <option value="">Any type</option>
          {Object.entries(INVOICE_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <TextField label="Issued from" type="date" value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || undefined })} />
        <TextField label="Issued to" type="date" value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || undefined })} />
        <div className="sm:col-span-2"><TextField label="Invoice number" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="For example INV-2026" maxLength={30} /></div>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={Boolean(filters.overdue)} onChange={(e) => go({ overdue: e.target.checked || undefined })} />Overdue only</label>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading invoices…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the invoices" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No invoices match these filters." : "No invoices yet."}</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "invoice" : "invoices"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((i) => (
                <li key={i.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/finance/invoices/${encodeURIComponent(i.id)}`} className="font-mono text-lg font-semibold underline">{i.number}</Link>
                      <p className="text-sm opacity-80">{formatMinorAmount(i.total_minor, i.currency)}{i.refunded_minor > 0 ? ` (refunded ${formatMinorAmount(i.refunded_minor, i.currency)})` : ""} · {INVOICE_KIND_LABELS[i.kind] ?? i.kind}{i.billing_name ? ` · ${i.billing_name}` : ""}{i.tracking_number ? <> · <span className="font-mono">{i.tracking_number}</span></> : null}</p>
                      <p className="text-sm opacity-80">issued {formatDate(i.issued_at)}{i.due_at && i.status === "issued" ? ` · due ${formatDate(i.due_at)}` : ""}{i.paid_at ? ` · paid ${formatDate(i.paid_at)}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {i.overdue ? <StatusChip label="Overdue" tone="bad" /> : null}
                      <StatusChip label={INVOICE_STATUS_LABELS[i.status] ?? i.status} tone={invoiceTone(i.status, false)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => invoicesHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
