"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { fetchAdminTickets, fetchTicketAssignees, type TicketFilters } from "@/lib/admin/api";
import { dueIn, PRIORITY_LABELS, priorityTone, TICKET_STATUS_LABELS, ticketTone } from "@/lib/admin/labels";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/admin/schemas";
import { CATEGORY_LABELS } from "@/lib/support/labels";
import { AdminProblem } from "./admin-shell";

const ASSIGNEES = new Set(["me", "unassigned"]);
const isPersonId = (value: string | null): value is string => value !== null && /^[0-9A-Za-z]{26}$/.test(value);

export function filtersFrom(params: URLSearchParams): TicketFilters {
  const pick = (key: string, allowed: readonly string[]) => (allowed.includes(params.get(key) ?? "") ? (params.get(key) as string) : undefined);

  return {
    status: pick("status", TICKET_STATUSES), priority: pick("priority", TICKET_PRIORITIES), category: pick("category", Object.keys(CATEGORY_LABELS)),
    assigned_to: isPersonId(params.get("assigned_to")) ? (params.get("assigned_to") as string) : pick("assigned_to", [...ASSIGNEES]), breached: params.get("breached") === "1" || undefined, q: params.get("q")?.trim().slice(0, 100) || undefined,
    page: parsePage(params.get("page")),
  };
}

export function ticketsHref(filters: TicketFilters, page = 1): string {
  const search = new URLSearchParams();
  const entries: [string, string | undefined][] = [["status", filters.status], ["priority", filters.priority], ["category", filters.category], ["assigned_to", filters.assigned_to], ["breached", filters.breached ? "1" : undefined], ["q", filters.q], ["page", page > 1 ? String(page) : undefined]];
  for (const [key, value] of entries) if (value) search.set(key, value);
  const text = search.toString();

  return `/admin/tickets${text ? `?${text}` : ""}`;
}

export function TicketsQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = filtersFrom(new URLSearchParams(params.toString()));
  const [search, setSearch] = useState(filters.q ?? "");
  const people = useQuery({ queryKey: ["admin-assignees"], queryFn: ({ signal }) => fetchTicketAssignees(signal), staleTime: 300_000, retry: false });
  const list = useQuery({ queryKey: ["admin-tickets", filters], queryFn: ({ signal }) => fetchAdminTickets(filters, signal), placeholderData: keepPreviousData, retry: false, refetchInterval: 60_000 });
  const go = (change: Partial<TicketFilters>) => router.replace(ticketsHref({ ...filters, ...change, page: undefined }));
  const submit = (event: FormEvent) => { event.preventDefault(); go({ q: search.trim() || undefined }); };
  const anyFilter = Boolean(filters.status || filters.priority || filters.category || filters.assigned_to || filters.breached || filters.q);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Support tickets</h1>
      <form onSubmit={submit} role="search" aria-label="Filter tickets" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Status" value={filters.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">Any status</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
        </SelectField>
        <SelectField label="Priority" value={filters.priority ?? ""} onChange={(e) => go({ priority: e.target.value || undefined })}>
          <option value="">Any priority</option>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </SelectField>
        <SelectField label="Category" value={filters.category ?? ""} onChange={(e) => go({ category: e.target.value || undefined })}>
          <option value="">Any category</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="Assigned to" value={filters.assigned_to ?? ""} onChange={(e) => go({ assigned_to: e.target.value || undefined })}>
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Nobody yet</option>
          {(people.data ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </SelectField>
        <div className="sm:col-span-2"><TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticket number or subject" maxLength={100} /></div>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={Boolean(filters.breached)} onChange={(e) => go({ breached: e.target.checked || undefined })} />First reply overdue</label>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading tickets…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the tickets" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No tickets match these filters." : "No tickets yet."}</p> : null}

        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "ticket" : "tickets"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching}>
              {list.data.items.map((t) => {
                const waiting = t.first_response_at === null && ["open", "pending_staff"].includes(t.status) ? dueIn(t.first_response_due_at) : null;

                return (
                  <li key={t.id} className="rounded-md border border-foreground/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/admin/tickets/${encodeURIComponent(t.id)}`} className="break-words text-lg font-semibold underline">{t.subject}</Link>
                        <p className="text-sm opacity-80"><span className="font-mono">{t.number}</span> · {t.requester.name ?? t.requester.email ?? "Guest"} · {CATEGORY_LABELS[t.category] ?? t.category}{t.tracking_number ? <> · <span className="font-mono">{t.tracking_number}</span></> : null}</p>
                        {t.assignee ? <p className="text-sm opacity-80">Handled by {t.assignee.name}</p> : null}
                        {waiting ? <p className={t.sla_breached ? "mt-1 text-sm font-medium text-red-800" : "mt-1 text-sm opacity-80"}>First reply {waiting}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {t.sla_breached ? <StatusChip label="Overdue" tone="bad" /> : null}
                        <StatusChip label={PRIORITY_LABELS[t.priority] ?? t.priority} tone={priorityTone(t.priority)} />
                        <StatusChip label={TICKET_STATUS_LABELS[t.status] ?? t.status} tone={ticketTone(t.status)} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => ticketsHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
