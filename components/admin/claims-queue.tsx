"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parsePage } from "@/components/account/shipments-list";
import { SelectField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchAdminClaims, type ClaimFilters } from "@/lib/admin/api";
import { CLAIM_STATUS_LABELS, claimTone } from "@/lib/admin/labels";
import { CLAIM_STATUSES } from "@/lib/admin/schemas";
import { formatDate, formatMoney } from "@/lib/shipping/format";
import { CLAIM_TYPE_LABELS } from "@/lib/support/labels";
import { AdminProblem } from "./admin-shell";

export function claimFiltersFrom(params: URLSearchParams): ClaimFilters {
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? "";

  return { status: (CLAIM_STATUSES as readonly string[]).includes(status) ? status : undefined, type: Object.keys(CLAIM_TYPE_LABELS).includes(type) ? type : undefined, page: parsePage(params.get("page")) };
}

export function claimsHref(filters: ClaimFilters, page = 1): string {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.type) search.set("type", filters.type);
  if (page > 1) search.set("page", String(page));
  const text = search.toString();

  return `/admin/claims${text ? `?${text}` : ""}`;
}

export function ClaimsQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const filters = claimFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const list = useQuery({ queryKey: ["admin-claims", filters], queryFn: ({ signal }) => fetchAdminClaims(filters, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });
  const go = (change: Partial<ClaimFilters>) => router.replace(claimsHref({ ...filters, ...change }));
  const anyFilter = Boolean(filters.status || filters.type);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Claims</h1>
      <form role="search" aria-label="Filter claims" className="mt-6 grid gap-3 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <SelectField label="Status" value={filters.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">Any status</option>
          {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{CLAIM_STATUS_LABELS[s]}</option>)}
        </SelectField>
        <SelectField label="Type" value={filters.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })}>
          <option value="">Any type</option>
          {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        {anyFilter ? <div className="flex items-end"><Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link></div> : null}
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading claims…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the claims" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No claims match these filters." : "No claims yet."}</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "claim" : "claims"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((c) => (
                <li key={c.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link href={`/admin/claims/${encodeURIComponent(c.id)}`} className="text-lg font-semibold underline">{CLAIM_TYPE_LABELS[c.type] ?? c.type} · {formatMoney(c.claimed)}</Link>
                      <p className="text-sm opacity-80"><span className="font-mono">{c.number}</span> · <span className="font-mono">{c.tracking_number}</span> · filed {formatDate(c.created_at)}</p>
                      {c.approved ? <p className="text-sm">Approved: {formatMoney(c.approved)}{c.paid ? ` · paid ${formatMoney(c.paid)}` : ""}</p> : null}
                    </div>
                    <StatusChip label={CLAIM_STATUS_LABELS[c.status] ?? c.status} tone={claimTone(c.status)} />
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => claimsHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
