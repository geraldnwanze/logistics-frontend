"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchShipments, type ShipmentFilter } from "@/lib/shipping/api";
import { formatDate, formatMoney, statusTone } from "@/lib/shipping/format";
import type { Shipment } from "@/lib/shipping/schemas";

const FILTERS: { value: ShipmentFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "active", label: "In progress" }, { value: "delivered", label: "Delivered" }, { value: "cancelled", label: "Cancelled" },
];

export function parseFilter(value: string | null): ShipmentFilter {
  return FILTERS.some((f) => f.value === value) ? (value as ShipmentFilter) : "all";
}

export function parsePage(value: string | null): number {
  const page = Number(value);

  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export function listHref(status: ShipmentFilter, q: string, page: number): string {
  const query = new URLSearchParams();
  if (status !== "all") query.set("status", status);
  if (q.trim() !== "") query.set("q", q.trim());
  if (page > 1) query.set("page", String(page));

  return `/account/shipments${query.size > 0 ? `?${query}` : ""}`;
}

export function ShipmentsList() {
  const router = useRouter();
  const params = useSearchParams();
  const status = parseFilter(params.get("status"));
  const q = (params.get("q") ?? "").slice(0, 40);
  const page = parsePage(params.get("page"));
  const [search, setSearch] = useState(q);
  const list = useQuery({ queryKey: ["shipments", status, q, page], queryFn: ({ signal }) => fetchShipments({ status, q, page }, signal), placeholderData: keepPreviousData, retry: false });

  function onSearch(event: FormEvent) {
    event.preventDefault();
    router.push(listHref(status, search, 1));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter shipments" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f.value} href={listHref(f.value, q, 1)} aria-current={f.value === status ? "true" : undefined}
              className={buttonVariants({ variant: f.value === status ? "primary" : "outline", size: "sm" })}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form onSubmit={onSearch} role="search" className="flex gap-2">
          <label htmlFor="shipment-search" className="sr-only">Search by tracking number</label>
          <input id="shipment-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tracking number" maxLength={40} className="h-9 w-44 rounded-md border border-foreground/25 bg-background px-3 text-sm" />
          <Button type="submit" size="sm" variant="outline">Search</Button>
        </form>
      </div>

      <div className="mt-6" aria-busy={list.isFetching}>
        {list.isPending ? <p role="status">Loading your shipments…</p> : null}

        {list.isError ? (
          <div role="alert" className="rounded-md border border-foreground/20 p-4">
            <p>We couldn&apos;t load your shipments right now.</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>
          </div>
        ) : null}

        {list.data && list.data.items.length === 0 ? <EmptyState filtered={status !== "all" || q !== ""} /> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-3 text-sm opacity-75" role="status">{list.data.total} shipment{list.data.total === 1 ? "" : "s"}</p>
            <ul className="space-y-3">
              {list.data.items.map((shipment) => <ShipmentRow key={shipment.id} shipment={shipment} />)}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(p) => listHref(status, q, p)} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return filtered ? (
    <div role="status" className="rounded-md border border-foreground/20 p-4">
      <p>No shipments match.</p>
      <Link href="/account/shipments" className="mt-2 inline-block underline">Show all shipments</Link>
    </div>
  ) : (
    <div role="status" className="rounded-md border border-foreground/20 p-6 text-center">
      <p className="text-lg font-medium">You haven&apos;t booked a shipment yet.</p>
      <Link href="/quote" className={buttonVariants({ className: "mt-3" })}>Get a quote</Link>
    </div>
  );
}

function ShipmentRow({ shipment }: { shipment: Shipment }) {
  const route = [shipment.sender, shipment.recipient].map((p) => (p ? `${p.city}, ${p.country}` : "—")).join(" → ");

  return (
    <li className="rounded-md border border-foreground/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/shipments/${encodeURIComponent(shipment.id)}`} className="break-all font-mono text-lg font-semibold underline">{shipment.tracking_number}</Link>
          <p className="text-sm opacity-80">{route}</p>
          <p className="text-sm opacity-80">{shipment.service.name} · booked {formatDate(shipment.created_at)}</p>
        </div>
        <div className="text-right">
          <StatusChip label={shipment.status_label} tone={statusTone(shipment.status)} />
          <p className="mt-1 font-semibold">{formatMoney(shipment.total)}</p>
          {shipment.payment.requires_payment ? <p className="text-sm font-medium text-amber-800">Payment needed</p> : null}
        </div>
      </div>
    </li>
  );
}
