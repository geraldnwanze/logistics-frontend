"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pager, StatusChip } from "@/components/ui/pager";
import { parsePage } from "@/components/account/shipments-list";
import { fetchTickets } from "@/lib/support/api";
import { CATEGORY_LABELS, ticketStatus } from "@/lib/support/labels";

const hrefFor = (page: number) => `/account/support${page > 1 ? `?page=${page}` : ""}`;

export function TicketsList() {
  const page = parsePage(useSearchParams().get("page"));
  const list = useQuery({ queryKey: ["tickets", page], queryFn: ({ signal }) => fetchTickets(page, signal), placeholderData: keepPreviousData, retry: false });

  return (
    <div>
      <div className="mb-4 flex justify-end"><Link href="/support" className={buttonVariants({ size: "sm" })}>New message</Link></div>

      {list.isPending ? <p role="status">Loading your conversations…</p> : null}

      {list.isError ? (
        <div role="alert" className="rounded-md border border-foreground/20 p-4">
          <p>We couldn&apos;t load your conversations right now.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>
        </div>
      ) : null}

      {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">You haven&apos;t contacted support yet.</p> : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="space-y-3" aria-busy={list.isFetching}>
            {list.data.items.map((t) => {
              const status = ticketStatus(t.status);

              return (
                <li key={t.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link href={`/support/tickets/${encodeURIComponent(t.id)}`} className="text-lg font-semibold underline">{t.subject}</Link>
                      <p className="text-sm opacity-80"><span className="font-mono">{t.number}</span> · {CATEGORY_LABELS[t.category] ?? t.category} · updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(t.last_activity_at))}</p>
                    </div>
                    <StatusChip label={status.text} tone={status.tone} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={hrefFor} />
        </>
      ) : null}
    </div>
  );
}
