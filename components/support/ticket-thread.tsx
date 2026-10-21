"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { closeTicket, fetchTicket, fetchTicketAttachmentLink, replyToTicket } from "@/lib/support/api";
import { CATEGORY_LABELS, ticketStatus } from "@/lib/support/labels";
import { AttachmentLinks, AttachmentPicker } from "./attachment-picker";
import { ATTACHMENT_ERRORS } from "./new-ticket-form";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function TicketThread({ id }: { id: string }) {
  const client = useQueryClient();
  const ticket = useQuery({ queryKey: ["ticket", id], queryFn: ({ signal }) => fetchTicket(id, signal), retry: false, refetchInterval: 60_000 });
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ticket.isPending) return <p role="status">Loading your conversation…</p>;

  if (ticket.isError) {
    const missing = ticket.error instanceof ApiError && ticket.error.status === 404;

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this conversation. If you wrote to us as a guest, open this page in the same browser tab you used, or reply to our email." : "We couldn't load this conversation right now."}</p>
        <div className="mt-3 flex gap-2">
          {missing ? <Link href="/support" className={buttonVariants({ size: "sm" })}>Contact support</Link> : <Button size="sm" variant="outline" onClick={() => void ticket.refetch()}>Try again</Button>}
        </div>
      </div>
    );
  }

  const t = ticket.data;
  const status = ticketStatus(t.status);
  const closed = t.status === "closed";

  async function send(event: FormEvent) {
    event.preventDefault();
    if (reply.trim() === "") return;
    setPending(true);
    setError(null);

    try {
      client.setQueryData(["ticket", id], await replyToTicket(id, reply.trim(), files));
      setReply("");
      setFiles([]);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "ticket_closed" ? "This ticket has just been closed. Please open a new one."
        : caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code) ? caught.message : describeError(caught));
      if (caught instanceof ApiError && caught.code === "ticket_closed") await ticket.refetch();
    } finally {
      setPending(false);
    }
  }

  async function close() {
    setPending(true);
    setError(null);

    try {
      await closeTicket(id);
      setConfirmClose(false);
      await ticket.refetch();
      await client.invalidateQueries({ queryKey: ["tickets"] });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-sm opacity-75">{t.number}</p>
        <h2 className="text-2xl font-semibold">{t.subject}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={status.text} tone={status.tone} />
          <span className="opacity-75">{CATEGORY_LABELS[t.category] ?? t.category}</span>
          {t.tracking_number ? <Link href={`/track/${encodeURIComponent(t.tracking_number)}`} className="font-mono underline">{t.tracking_number}</Link> : null}
        </p>
      </header>

      <ol aria-label="Messages" className="space-y-3">
        {t.messages.map((m, i) => (
          <li key={i} className={m.from === "customer" ? "rounded-md bg-foreground/5 p-4" : "rounded-md border border-foreground/20 p-4"}>
            <p className="text-sm font-semibold">{m.from === "customer" ? "You" : "Support team"} <span className="font-normal opacity-70">· {when(m.created_at)}</span></p>
            <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
            <AttachmentLinks attachments={m.attachments} load={(attachmentId) => fetchTicketAttachmentLink(id, attachmentId)} />
          </li>
        ))}
      </ol>

      <FormAlert message={error} />

      {closed ? (
        <p role="status" className="rounded-md border border-foreground/20 p-4">This ticket is closed. <Link href="/support" className="underline">Open a new one</Link> if you need more help.</p>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <div>
            <label htmlFor="ticket-reply" className="mb-1 block text-sm font-medium">Your reply</label>
            <textarea id="ticket-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={5000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
            {t.status === "resolved" ? <p className="mt-1 text-xs opacity-75">This ticket is marked resolved. Replying will reopen it.</p> : null}
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={pending} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || reply.trim() === ""}>{pending ? "Sending…" : "Send reply"}</Button>
            {confirmClose ? (
              <span role="group" aria-label="Confirm closing" className="flex items-center gap-2 text-sm">
                Close this ticket?
                <Button type="button" size="sm" variant="outline" onClick={close} disabled={pending}>Yes, close it</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>Keep open</Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmClose(true)}>Close this ticket</Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
