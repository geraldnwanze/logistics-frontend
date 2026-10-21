"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AttachmentLinks, AttachmentPicker } from "@/components/support/attachment-picker";
import { ATTACHMENT_ERRORS } from "@/components/support/new-ticket-form";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { fetchAdminTicket, fetchAdminTicketAttachmentLink, fetchTicketAssignees, replyToTicketAsStaff, updateTicket, type TicketChanges } from "@/lib/admin/api";
import { dueIn, PRIORITY_LABELS, priorityTone, TICKET_STATUS_LABELS, ticketTone } from "@/lib/admin/labels";
import { TICKET_PRIORITIES, TICKET_STATUSES, type AdminTicket } from "@/lib/admin/schemas";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { CATEGORY_LABELS } from "@/lib/support/labels";
import { AdminProblem } from "./admin-shell";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

type AfterReply = "pending_customer" | "resolved" | "open";

export function TicketDetail({ id, userId, userName }: { id: string; userId: string; userName: string }) {
  const client = useQueryClient();
  const ticket = useQuery({ queryKey: ["admin-ticket", id], queryFn: ({ signal }) => fetchAdminTicket(id, signal), retry: false, refetchInterval: 30_000 });
  const people = useQuery({ queryKey: ["admin-assignees"], queryFn: ({ signal }) => fetchTicketAssignees(signal), staleTime: 300_000, retry: false });
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<AfterReply>("pending_customer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (ticket.isPending) return <p role="status">Loading the ticket…</p>;
  if (ticket.isError) return <AdminProblem error={ticket.error} what="this ticket" onRetry={() => void ticket.refetch()} />;

  const t = ticket.data;
  const closed = t.status === "closed";
  const colleagues = [...(people.data ?? [])];
  for (const known of [{ id: userId, name: userName }, ...(t.assignee ? [t.assignee] : [])]) if (!colleagues.some((c) => c.id === known.id)) colleagues.push(known);   // the list may be down, or the current person may since have left
  const overdue = t.first_response_at === null && ["open", "pending_staff"].includes(t.status) ? dueIn(t.first_response_due_at) : null;

  async function change(changes: TicketChanges, what: string) {
    setPending(true);
    setError(null);
    setSaved(null);

    try {
      const summary = await updateTicket(id, changes);
      client.setQueryData<AdminTicket>(["admin-ticket", id], (old) => (old ? { ...old, ...summary } : old));
      await client.invalidateQueries({ queryKey: ["admin-tickets"] });
      setSaved(what);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (message.trim() === "") return;
    setPending(true);
    setError(null);
    setSaved(null);

    try {
      client.setQueryData(["admin-ticket", id], await replyToTicketAsStaff(id, { message: message.trim(), internal, status: after }, files));
      await client.invalidateQueries({ queryKey: ["admin-tickets"] });
      setMessage("");
      setFiles([]);
      setInternal(false);
      setSaved(internal ? "Note added." : "Reply sent.");
    } catch (caught) {
      setError(caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code) ? caught.message : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <p><Link href="/admin/tickets" className="text-sm underline">← All tickets</Link></p>
      <header>
        <p className="font-mono text-sm opacity-75">{t.number}</p>
        <h1 className="break-words text-2xl font-semibold">{t.subject}</h1>
        <p className="mt-1 text-sm">
          From {t.requester.name ? `${t.requester.name} ` : ""}{t.requester.email ? <a className="underline" href={`mailto:${t.requester.email}`}>{t.requester.email}</a> : "a guest"} · {CATEGORY_LABELS[t.category] ?? t.category}
          {t.tracking_number ? <> · <Link href={`/track/${encodeURIComponent(t.tracking_number)}`} className="font-mono underline">{t.tracking_number}</Link></> : null} · opened {when(t.created_at)}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip label={TICKET_STATUS_LABELS[t.status] ?? t.status} tone={ticketTone(t.status)} />
          <StatusChip label={PRIORITY_LABELS[t.priority] ?? t.priority} tone={priorityTone(t.priority)} />
          {t.sla_breached ? <StatusChip label="First reply overdue" tone="bad" /> : null}
          {overdue && !t.sla_breached ? <span className="text-sm opacity-80">First reply {overdue}</span> : null}
        </p>
      </header>

      <section aria-labelledby="handling-heading" className="rounded-md border border-foreground/20 p-4">
        <h2 id="handling-heading" className="text-lg font-semibold">Handling</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="Status" value={t.status} disabled={pending} onChange={(e) => void change({ status: e.target.value }, "Status updated.")}>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
          </SelectField>
          <SelectField label="Priority" value={t.priority} disabled={pending} onChange={(e) => void change({ priority: e.target.value }, "Priority updated.")}>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </SelectField>
          <SelectField label="Category" value={t.category} disabled={pending} onChange={(e) => void change({ category: e.target.value }, "Category updated.")}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          <SelectField label="Assigned to" value={t.assigned_to ?? ""} disabled={pending} hint={people.isError ? "The list of colleagues couldn't be loaded." : undefined} onChange={(e) => void change({ assigned_to: e.target.value || null }, e.target.value === "" ? "Unassigned." : e.target.value === userId ? "Assigned to you." : `Assigned to ${colleagues.find((c) => c.id === e.target.value)?.name ?? "a colleague"}.`)}>
            <option value="">Nobody</option>
            {colleagues.map((c) => <option key={c.id} value={c.id}>{c.id === userId ? `${c.name} (you)` : c.name}</option>)}
          </SelectField>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {t.assigned_to === null ? "Nobody is handling this yet." : t.assigned_to === userId ? "You are handling this." : `${t.assignee?.name ?? "A colleague"} is handling this.`}
          {t.assigned_to !== userId ? <Button size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={() => void change({ assigned_to: userId }, "Assigned to you.")}>Assign to me</Button> : null}
        </p>
        {saved ? <p role="status" className="mt-2 text-sm text-green-900">{saved}</p> : null}
      </section>

      <section aria-labelledby="thread-heading">
        <h2 id="thread-heading" className="text-lg font-semibold">Conversation</h2>
        <ol aria-label="Messages" className="mt-3 space-y-3">
          {t.messages.map((m) => (
            <li key={m.id} className={m.internal ? "rounded-md border border-amber-700/40 bg-amber-50 p-4 text-amber-950" : m.from === "staff" ? "rounded-md border border-foreground/20 bg-foreground/5 p-4" : "rounded-md border border-foreground/20 p-4"}>
              <p className="text-xs opacity-75">
                {m.internal ? <strong>Internal note, not visible to the customer</strong> : m.from === "staff" ? <strong>Support team</strong> : <strong>Customer</strong>} · {when(m.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
              <AttachmentLinks attachments={m.attachments} load={(attachmentId) => fetchAdminTicketAttachmentLink(id, attachmentId)} />
            </li>
          ))}
        </ol>
      </section>

      <FormAlert message={error} />
      {closed ? (
        <p role="status" className="rounded-md border border-foreground/20 p-4 text-sm">This ticket is closed. Set its status to Open to reply again.</p>
      ) : (
        <form onSubmit={send} className="space-y-3" aria-label="Reply">
          <div>
            <label htmlFor="staff-reply" className="mb-1 block text-sm font-medium">{internal ? "Internal note" : "Reply to the customer"}</label>
            <textarea id="staff-reply" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={pending} hint={internal ? "Files on a private note are only visible to staff." : "The customer will be able to download these."} />
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note only (the customer won&apos;t see it)</label>
          {internal ? null : (
            <SelectField label="After sending, set the ticket to" value={after} onChange={(e) => setAfter(e.target.value as AfterReply)}>
              <option value="pending_customer">Waiting for customer</option>
              <option value="resolved">Resolved</option>
              <option value="open">Open</option>
            </SelectField>
          )}
          <Button type="submit" disabled={pending || message.trim() === ""}>{pending ? "Sending…" : internal ? "Add note" : "Send reply"}</Button>
        </form>
      )}
    </div>
  );
}
