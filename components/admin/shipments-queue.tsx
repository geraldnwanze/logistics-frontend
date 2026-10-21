"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchAdminShipments, fetchShipmentAssignees, type ShipmentFilters } from "@/lib/admin/shipments";
import { can, STAGES } from "@/lib/admin/labels";
import type { User } from "@/lib/auth/schemas";
import { formatDate, formatMoney, statusTone } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";

const SORTS: Record<string, { label: string; sort: string; dir: string }> = {
  newest: { label: "Newest first", sort: "created_at", dir: "desc" },
  oldest: { label: "Oldest first", sort: "created_at", dir: "asc" },
  updated: { label: "Recently updated", sort: "status_changed_at", dir: "desc" },
};

const isPersonId = (value: string | null): value is string => value !== null && /^[0-9A-Za-z]{26}$/.test(value);

export type ShipmentView = ShipmentFilters & { order?: string };

export function shipmentFiltersFrom(params: URLSearchParams): ShipmentView {
  const stage = params.get("stage") ?? "";
  const assigned = params.get("assigned_to");
  const order = params.get("order") ?? "";

  return {
    q: params.get("q")?.trim().slice(0, 100) || undefined,
    stage: STAGES.some((s) => s.value === stage) ? stage : undefined,
    assigned_to: assigned === "me" || assigned === "unassigned" || isPersonId(assigned) ? assigned : undefined,
    order: order in SORTS && order !== "newest" ? order : undefined,
    page: parsePage(params.get("page")),
  };
}

export function shipmentsHref(view: ShipmentView, page = 1): string {
  const search = new URLSearchParams();
  const entries: [string, string | undefined][] = [["q", view.q], ["stage", view.stage], ["assigned_to", view.assigned_to], ["order", view.order], ["page", page > 1 ? String(page) : undefined]];
  for (const [key, value] of entries) if (value) search.set(key, value);
  const text = search.toString();

  return `/admin/shipments${text ? `?${text}` : ""}`;
}

export function ShipmentsQueue({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();
  const view = shipmentFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const [search, setSearch] = useState(view.q ?? "");
  const sort = SORTS[view.order ?? "newest"];
  const filters: ShipmentFilters = { q: view.q, stage: view.stage, assigned_to: view.assigned_to, sort: sort.sort, dir: sort.dir, page: view.page };
  const list = useQuery({ queryKey: ["admin-shipments", filters], queryFn: ({ signal }) => fetchAdminShipments(filters, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });
  const people = useQuery({ queryKey: ["admin-shipment-assignees"], queryFn: ({ signal }) => fetchShipmentAssignees(signal), enabled: can(user, "shipments.assign"), staleTime: 300_000, retry: false });
  const go = (change: Partial<ShipmentView>) => router.replace(shipmentsHref({ ...view, ...change, page: undefined }));
  const anyFilter = Boolean(view.q || view.stage || view.assigned_to);

  function submit(event: FormEvent) {
    event.preventDefault();
    go({ q: search.trim() || undefined });
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold">Shipments</h1>
      <form onSubmit={submit} role="search" aria-label="Filter shipments" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tracking number, invoice number or customer" maxLength={100} /></div>
        <SelectField label="Stage" value={view.stage ?? ""} onChange={(e) => go({ stage: e.target.value || undefined })}>
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </SelectField>
        <SelectField label="Assigned to" value={view.assigned_to ?? ""} onChange={(e) => go({ assigned_to: e.target.value || undefined })}>
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Nobody yet</option>
          {(people.data ?? []).filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        <SelectField label="Order" value={view.order ?? "newest"} onChange={(e) => go({ order: e.target.value })}>
          {Object.entries(SORTS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading shipments…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the shipments" onRetry={() => void list.refetch()} /> : null}
        {list.data?.searchLimited ? <p role="note" className="mb-3 rounded-md border border-amber-700/40 bg-amber-50 p-3 text-sm text-amber-950">{list.data.searchLimited}</p> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No shipments match these filters." : "No shipments yet."}</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "shipment" : "shipments"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((s) => (
                <li key={s.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/shipments/${encodeURIComponent(s.id)}`} className="font-mono text-lg font-semibold underline">{s.tracking_number}</Link>
                      <p className="text-sm opacity-80">{s.origin.city}, {s.origin.country} → {s.destination.city}, {s.destination.country} · {s.service} · {formatMoney(s.total)}{s.payment_status ? ` · ${s.payment_status}` : ""}</p>
                      <p className="text-sm opacity-80">
                        {s.customer ? <>{s.customer.name ?? s.customer.email}{s.customer.name && s.customer.email ? ` (${s.customer.email})` : ""} · </> : null}
                        created {formatDate(s.created_at)}{s.assignee ? ` · handled by ${s.assignee.name}` : ""}{s.facility ? ` · ${s.facility}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.delayed ? <StatusChip label="Running late" tone="warn" /> : null}
                      <StatusChip label={s.status.label} tone={statusTone(s.status.code)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => shipmentsHref(view, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
