"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { Pager, StatusChip } from "@/components/ui/pager";
import { formatDate, formatMoney } from "@/lib/shipping/format";
import { fetchClaims } from "@/lib/support/api";
import { CLAIM_TYPE_LABELS, claimStatus } from "@/lib/support/labels";

const hrefFor = (page: number) => `/account/claims${page > 1 ? `?page=${page}` : ""}`;

export function ClaimsList() {
  const page = parsePage(useSearchParams().get("page"));
  const list = useQuery({ queryKey: ["claims", page], queryFn: ({ signal }) => fetchClaims(page, signal), placeholderData: keepPreviousData, retry: false });

  if (list.isPending) return <p role="status">Loading your claims…</p>;

  if (list.isError) {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>We couldn&apos;t load your claims right now.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>
      </div>
    );
  }

  if (list.data.items.length === 0) {
    return (
      <div role="status" className="rounded-md border border-foreground/20 p-6 text-center">
        <p className="text-lg font-medium">You haven&apos;t made any claims.</p>
        <p className="mt-1 text-sm opacity-80">If a shipment is lost, damaged or late, open it from <Link href="/account/shipments" className="underline">your shipments</Link> and choose &ldquo;Make a claim&rdquo;.</p>
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-3" aria-busy={list.isFetching}>
        {list.data.items.map((c) => {
          const status = claimStatus(c.status);

          return (
            <li key={c.id} className="rounded-md border border-foreground/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/claims/${encodeURIComponent(c.id)}`} className="text-lg font-semibold underline">{CLAIM_TYPE_LABELS[c.type] ?? c.type}</Link>
                  <p className="text-sm opacity-80"><span className="font-mono">{c.number}</span> · shipment <span className="font-mono">{c.tracking_number}</span> · filed {formatDate(c.created_at)}</p>
                </div>
                <div className="text-right"><StatusChip label={status.text} tone={status.tone} /><p className="mt-1 font-semibold">{formatMoney(c.claimed)}</p></div>
              </div>
            </li>
          );
        })}
      </ul>
      <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={hrefFor} />
    </div>
  );
}
