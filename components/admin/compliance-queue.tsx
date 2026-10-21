"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { parsePage } from "@/components/account/shipments-list";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchComplianceQueue } from "@/lib/admin/customs";
import { FINDING_ACTION_LABELS } from "@/lib/admin/labels";
import { formatDate } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";

export function ComplianceQueue() {
  const page = parsePage(useSearchParams().get("page"));
  const list = useQuery({ queryKey: ["admin-compliance", page], queryFn: ({ signal }) => fetchComplianceQueue(page, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });

  return (
    <div>
      <h1 className="text-3xl font-semibold">Compliance review</h1>
      <p className="mt-2 text-sm opacity-80">Shipments held because something in them is restricted. Oldest first. Open one to see what matched and decide.</p>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading the queue…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the compliance queue" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">Nothing is waiting for review.</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "shipment" : "shipments"} waiting</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((s) => (
                <li key={s.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/shipments/${encodeURIComponent(s.id)}`} className="font-mono text-lg font-semibold underline">{s.tracking_number}</Link>
                      <p className="text-sm opacity-80">{s.origin.city}, {s.origin.country} → {s.destination.city}, {s.destination.country} · booked {formatDate(s.created_at)}{s.customer ? ` · ${s.customer.name ?? s.customer.email}` : ""}</p>
                      <ul aria-label="What matched" className="mt-2 space-y-1 text-sm">
                        {s.findings.map((f, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2"><StatusChip label={FINDING_ACTION_LABELS[f.action] ?? f.action} tone={f.action === "prohibited" ? "bad" : "warn"} /><strong>{f.label}</strong>{f.reason ? <span className="opacity-80">{f.reason}</span> : null}</li>
                        ))}
                      </ul>
                    </div>
                    <StatusChip label="Waiting for review" tone="warn" />
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(p) => `/admin/compliance${p > 1 ? `?page=${p}` : ""}`} />
          </>
        ) : null}
      </div>
    </div>
  );
}
