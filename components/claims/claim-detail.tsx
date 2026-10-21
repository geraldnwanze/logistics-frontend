"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { formatDate, formatMoney } from "@/lib/shipping/format";
import { addClaimNote, fetchClaim, fetchClaimAttachmentLink, withdrawClaim } from "@/lib/support/api";
import { CLAIM_FINISHED, CLAIM_TYPE_LABELS, CLAIM_WITHDRAWABLE, claimStatus } from "@/lib/support/labels";
import { AttachmentLinks, AttachmentPicker } from "@/components/support/attachment-picker";
import { ATTACHMENT_ERRORS } from "@/components/support/new-ticket-form";

export function ClaimDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const claim = useQuery({ queryKey: ["claim", id], queryFn: ({ signal }) => fetchClaim(id, signal), retry: false });
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  if (claim.isPending) return <p role="status">Loading your claim…</p>;

  if (claim.isError) {
    const missing = claim.error instanceof ApiError && claim.error.status === 404;

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this claim. If you filed it as a guest, open this page in the same browser tab you used." : "We couldn't load this claim right now."}</p>
        <div className="mt-3 flex gap-2">{missing ? <Link href="/support" className={buttonVariants({ size: "sm" })}>Contact support</Link> : <Button size="sm" variant="outline" onClick={() => void claim.refetch()}>Try again</Button>}</div>
      </div>
    );
  }

  const c = claim.data;
  const status = claimStatus(c.status);
  const finished = CLAIM_FINISHED.includes(c.status);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (note.trim() === "") return;
    setPending(true);
    setError(null);

    try {
      client.setQueryData(["claim", id], await addClaimNote(id, note.trim(), files));
      await client.invalidateQueries({ queryKey: ["claims"] });
      setNote("");
      setFiles([]);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? "This claim is finished, so it can't take new messages."
        : caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code) ? caught.message : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  async function withdraw() {
    setPending(true);
    setError(null);

    try {
      client.setQueryData(["claim", id], await withdrawClaim(id));
      await client.invalidateQueries({ queryKey: ["claims"] });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? "This claim has already been decided, so it can't be withdrawn." : describeError(caught));
    } finally {
      setPending(false);
      setConfirmWithdraw(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-sm opacity-75">{c.number}</p>
        <h2 className="text-2xl font-semibold">{CLAIM_TYPE_LABELS[c.type] ?? c.type}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={status.text} tone={status.tone} />
          <Link href={`/track/${encodeURIComponent(c.tracking_number)}`} className="font-mono underline">{c.tracking_number}</Link>
          <span className="opacity-75">happened {formatDate(c.incident_date)} · filed {formatDate(c.created_at)}</span>
        </p>
      </header>

      <p role="status" className={c.status === "info_requested" ? "rounded-md border border-amber-600/50 bg-amber-50 p-3 text-amber-950" : "text-sm"}>{status.explain}</p>
      {c.resolution_note ? <div className="rounded-md border border-foreground/20 p-4"><p className="font-medium">{c.status === "rejected" ? "Why we couldn't approve it" : "Our decision"}</p><p className="mt-1 whitespace-pre-wrap">{c.resolution_note}</p></div> : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="opacity-70">You claimed</dt><dd className="text-lg font-semibold">{formatMoney(c.claimed)}</dd></div>
        {c.approved ? <div><dt className="opacity-70">Approved</dt><dd className="text-lg font-semibold">{formatMoney(c.approved)}</dd></div> : null}
        {c.paid ? <div><dt className="opacity-70">Paid</dt><dd className="text-lg font-semibold">{formatMoney(c.paid)}</dd></div> : null}
      </dl>

      <section aria-labelledby="claim-story">
        <h3 id="claim-story" className="font-medium">What you told us</h3>
        <p className="mt-1 whitespace-pre-wrap break-words">{c.description}</p>
        <AttachmentLinks attachments={c.attachments} load={(attachmentId) => fetchClaimAttachmentLink(id, attachmentId)} />
      </section>

      {c.notes && c.notes.length > 0 ? (
        <section aria-labelledby="claim-messages">
          <h3 id="claim-messages" className="font-medium">Messages</h3>
          <ol className="mt-2 space-y-3">
            {c.notes.map((n, i) => (
              <li key={i} className={n.from === "customer" ? "rounded-md bg-foreground/5 p-4" : "rounded-md border border-foreground/20 p-4"}>
                <p className="text-sm font-semibold">{n.from === "customer" ? "You" : "Claims team"} <span className="font-normal opacity-70">· {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(n.created_at))}</span></p>
                <p className="mt-1 whitespace-pre-wrap break-words">{n.body}</p>
                <AttachmentLinks attachments={n.attachments} load={(attachmentId) => fetchClaimAttachmentLink(id, attachmentId)} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <FormAlert message={error} />
      {finished ? null : (
        <form onSubmit={send} className="space-y-3">
          <div>
            <label htmlFor="claim-note" className="mb-1 block text-sm font-medium">{c.status === "info_requested" ? "Your reply" : "Add a message"}</label>
            <textarea id="claim-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={3000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          </div>
          <AttachmentPicker files={files} onChange={setFiles} disabled={pending} />
          <Button type="submit" disabled={pending || note.trim() === ""}>{pending ? "Sending…" : "Send"}</Button>
        </form>
      )}
      {CLAIM_WITHDRAWABLE.includes(c.status) ? (
        confirmWithdraw ? (
          <div role="group" aria-label="Confirm withdrawing" className="flex flex-wrap items-center gap-2 rounded-md border border-foreground/20 p-3 text-sm">
            <span>Withdraw this claim? We&apos;ll stop reviewing it. You can file a new one later.</span>
            <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={withdraw} disabled={pending}>Yes, withdraw it</Button>
            <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmWithdraw(false)}>Keep it</Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setConfirmWithdraw(true)}>Withdraw this claim</Button>
        )
      ) : null}
    </div>
  );
}
