"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parsePage } from "@/components/account/shipments-list";
import { SelectField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchPayments, formatMinorAmount, type PaymentFilters } from "@/lib/admin/finance";
import { ATTEMPT_STATUS_LABELS, attemptTone } from "@/lib/admin/labels";
import { AdminProblem } from "./admin-shell";
import { FinanceTabs } from "./finance-tabs";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function paymentFiltersFrom(params: URLSearchParams): PaymentFilters {
  const status = params.get("status") ?? "";
  const provider = params.get("provider") ?? "";

  return { status: status in ATTEMPT_STATUS_LABELS ? status : undefined, provider: /^[a-z0-9_-]{1,30}$/.test(provider) ? provider : undefined, page: parsePage(params.get("page")) };
}

export function paymentsHref(filters: PaymentFilters, page = 1): string {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.provider) search.set("provider", filters.provider);
  if (page > 1) search.set("page", String(page));
  const text = search.toString();

  return `/admin/finance/payments${text ? `?${text}` : ""}`;
}

export function PaymentsQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const filters = paymentFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const list = useQuery({ queryKey: ["admin-payments", filters], queryFn: ({ signal }) => fetchPayments(filters, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });
  const go = (change: Partial<PaymentFilters>) => router.replace(paymentsHref({ ...filters, ...change }));
  const anyFilter = Boolean(filters.status || filters.provider);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Finance</h1>
      <div className="mt-4"><FinanceTabs current="/admin/finance/payments" /></div>
      <form role="search" aria-label="Filter payments" className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <SelectField label="Status" value={filters.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">Any status</option>
          {Object.entries(ATTEMPT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        {anyFilter ? <div className="flex items-end"><Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link></div> : null}
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading payments…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the payments" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No payments match these filters." : "No payments yet."}</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "payment" : "payments"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((p) => (
                <li key={p.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold">{formatMinorAmount(p.amount_minor, p.currency)} <span className="text-sm font-normal opacity-75">via {p.provider}</span></p>
                      <p className="text-sm opacity-80">Invoice <span className="font-mono">{p.invoice}</span> · {when(p.created_at)}</p>
                      {p.reference ? <p className="break-all font-mono text-xs opacity-75">{p.reference}</p> : null}
                      {p.failure_code ? <p className="text-sm">Failed: {p.failure_code.replace(/_/g, " ")}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.duplicate ? <StatusChip label="Duplicate payment" tone="bad" /> : null}
                      <StatusChip label={ATTEMPT_STATUS_LABELS[p.status] ?? p.status} tone={attemptTone(p.status)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => paymentsHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
