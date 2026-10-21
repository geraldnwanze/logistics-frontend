"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { AttachmentLinks, AttachmentPicker } from "@/components/support/attachment-picker";
import { ATTACHMENT_ERRORS } from "@/components/support/new-ticket-form";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { addClaimStaffNote, decideClaim, fetchAdminClaim, fetchAdminClaimAttachmentLink, payoutClaim, reviewClaim } from "@/lib/admin/api";
import { CLAIM_DECIDABLE, CLAIM_REVIEWABLE, CLAIM_STATUS_LABELS, can, claimTone } from "@/lib/admin/labels";
import type { AdminClaim } from "@/lib/admin/schemas";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";
import { formatDate, formatMoney } from "@/lib/shipping/format";
import { decimalPlaces, formatMinor, toMinor } from "@/lib/shipping/money";
import { CLAIM_TYPE_LABELS } from "@/lib/support/labels";
import { AdminProblem } from "./admin-shell";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

const KNOWN_ERRORS: Record<string, string> = {
  self_approval: "You can't decide a claim you made yourself. Ask a colleague.",
  claim_state: "This claim has moved on since you opened it. The page now shows its current state.",
  currency_mismatch: "The claim is in a different currency from the invoice, so it can't be refunded to the card. Record a manual payout instead.",
};

export function ClaimDetail({ id, user }: { id: string; user: User }) {
  const client = useQueryClient();
  const claim = useQuery({ queryKey: ["admin-claim", id], queryFn: ({ signal }) => fetchAdminClaim(id, signal), retry: false, refetchInterval: 60_000 });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (claim.isPending) return <p role="status">Loading the claim…</p>;
  if (claim.isError) return <AdminProblem error={claim.error} what="this claim" onRetry={() => void claim.refetch()} />;

  const c = claim.data;

  /** Runs a change, shows the claim it returns, and says what happened; a 409 reloads the claim because someone else got there first. */
  async function run(action: () => Promise<AdminClaim>, done: string): Promise<boolean> {
    setError(null);
    setSaved(null);

    try {
      client.setQueryData(["admin-claim", id], await action());
      await client.invalidateQueries({ queryKey: ["admin-claims"] });
      setSaved(done);

      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "claim_state") await claim.refetch();
      setError(caught instanceof ApiError && KNOWN_ERRORS[caught.code] ? KNOWN_ERRORS[caught.code] : caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code) ? caught.message : describeError(caught));

      return false;
    }
  }

  const decimals = decimalPlaces(c.claimed.amount);

  return (
    <div className="space-y-6">
      <p><Link href="/admin/claims" className="text-sm underline">← All claims</Link></p>
      <header>
        <p className="font-mono text-sm opacity-75">{c.number}</p>
        <h1 className="text-2xl font-semibold">{CLAIM_TYPE_LABELS[c.type] ?? c.type} · {formatMoney(c.claimed)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={CLAIM_STATUS_LABELS[c.status] ?? c.status} tone={claimTone(c.status)} />
          <Link href={`/track/${encodeURIComponent(c.tracking_number)}`} className="font-mono underline">{c.tracking_number}</Link>
          <span className="opacity-75">happened {formatDate(c.incident_date)} · filed {formatDate(c.created_at)}</span>
        </p>
      </header>

      <section aria-labelledby="money-heading" className="rounded-md border border-foreground/20 p-4">
        <h2 id="money-heading" className="text-lg font-semibold">Money</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt>Claimed</dt><dd>{formatMoney(c.claimed)}</dd></div>
          {c.limits ? <div className="flex justify-between gap-3"><dt>Most this shipment is covered for</dt><dd>{formatMinor(BigInt(c.limits.cap_minor), decimals, c.limits.currency)}</dd></div> : null}
          <div className="flex justify-between gap-3"><dt>Insured</dt><dd>{c.insured ? "Yes" : "No"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Approved</dt><dd>{c.approved ? formatMoney(c.approved) : "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt>Paid out</dt><dd>{c.paid ? formatMoney(c.paid) : "—"}</dd></div>
        </dl>
        {c.resolution_note ? <p className="mt-3 text-sm"><strong>Decision note:</strong> {c.resolution_note}{c.decided_at ? <span className="opacity-75"> ({when(c.decided_at)})</span> : null}</p> : null}
      </section>

      <section aria-labelledby="story-heading">
        <h2 id="story-heading" className="text-lg font-semibold">What the customer told us</h2>
        <p className="mt-2 whitespace-pre-wrap break-words">{c.description}</p>
        <AttachmentLinks attachments={c.attachments} load={(attachmentId) => fetchAdminClaimAttachmentLink(id, attachmentId)} />
      </section>

      <section aria-labelledby="thread-heading">
        <h2 id="thread-heading" className="text-lg font-semibold">Messages and notes</h2>
        {c.notes && c.notes.length > 0 ? (
          <ol aria-label="Messages" className="mt-3 space-y-3">
            {c.notes.map((n, i) => (
              <li key={`${n.created_at}-${i}`} className={n.internal ? "rounded-md border border-amber-700/40 bg-amber-50 p-4 text-amber-950" : n.from === "staff" ? "rounded-md border border-foreground/20 bg-foreground/5 p-4" : "rounded-md border border-foreground/20 p-4"}>
                <p className="text-xs opacity-75">{n.internal ? <strong>Internal note, not visible to the customer</strong> : n.from === "staff" ? <strong>Support team</strong> : <strong>Customer</strong>} · {when(n.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{n.body}</p>
                <AttachmentLinks attachments={n.attachments} load={(attachmentId) => fetchAdminClaimAttachmentLink(id, attachmentId)} />
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-sm opacity-75">Nothing yet.</p>}
      </section>

      <FormAlert message={error} />
      {saved ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}

      {can(user, "claims.manage") ? <Notes onAdd={(body, internal, files) => run(() => addClaimStaffNote(id, body, internal, files), internal ? "Note added." : "Message sent to the customer.")} /> : null}
      {can(user, "claims.manage") && CLAIM_REVIEWABLE.includes(c.status) ? <Review status={c.status} onReview={(status, note) => run(() => reviewClaim(id, status, note), status === "info_requested" ? "Asked the customer for more information." : "Marked as under review.")} /> : null}
      {can(user, "claims.approve") && CLAIM_DECIDABLE.includes(c.status) ? <Decide claim={c} decimals={decimals} onDecide={(decision) => run(() => decideClaim(id, decision), decision.decision === "approve" ? "Claim approved." : "Claim rejected.")} /> : null}
      {can(user, "refunds.approve") && c.status === "approved" ? <Payout claim={c} decimals={decimals} onPay={(payout, key) => run(() => payoutClaim(id, payout, key), "Payout recorded.")} /> : null}
    </div>
  );
}

function Notes({ onAdd }: { onAdd: (body: string, internal: boolean, files: File[]) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(true);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim() === "") return;
    setPending(true);
    if (await onAdd(body.trim(), internal, files)) {
      setBody("");
      setFiles([]);
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} aria-label="Add a note" className="space-y-3 rounded-md border border-foreground/20 p-4">
      <h2 className="text-lg font-semibold">Add a note</h2>
      <div>
        <label htmlFor="claim-staff-note" className="mb-1 block text-sm font-medium">{internal ? "Internal note" : "Message to the customer"}</label>
        <textarea id="claim-staff-note" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={3000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
      </div>
      <AttachmentPicker files={files} onChange={setFiles} disabled={pending} hint={internal ? "Files on an internal note are only visible to staff." : "The customer will be able to download these."} />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={!internal} onChange={(e) => setInternal(!e.target.checked)} />Show this to the customer</label>
      <Button type="submit" variant="outline" disabled={pending || body.trim() === ""}>{internal ? "Add note" : "Send to customer"}</Button>
    </form>
  );
}

function Review({ status, onReview }: { status: string; onReview: (status: "under_review" | "info_requested", note?: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    if (await onReview("info_requested", note.trim())) setNote("");
    setPending(false);
  }

  return (
    <section aria-labelledby="review-heading" className="space-y-3 rounded-md border border-foreground/20 p-4">
      <h2 id="review-heading" className="text-lg font-semibold">Review</h2>
      {status !== "under_review" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={async () => { setPending(true); await onReview("under_review"); setPending(false); }}>Mark as under review</Button>
      ) : null}
      {status !== "info_requested" ? (
        <form onSubmit={ask} aria-label="Ask for more information" className="space-y-2">
          <label htmlFor="claim-info-request" className="block text-sm font-medium">Ask the customer for more information</label>
          <textarea id="claim-info-request" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={3000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          <Button type="submit" variant="outline" disabled={pending || note.trim() === ""}>Ask the customer</Button>
        </form>
      ) : <p className="text-sm opacity-80">Waiting for the customer to reply.</p>}
    </section>
  );
}

function Decide({ claim, decimals, onDecide }: { claim: AdminClaim; decimals: number; onDecide: (d: Parameters<typeof decideClaim>[1]) => Promise<boolean> }) {
  const [choice, setChoice] = useState<"approve" | "reject">("approve");
  const [amount, setAmount] = useState(claim.claimed.amount);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const minor = toMinor(amount, decimals);
  const amountError = choice !== "approve" ? null : amount.trim() === "" ? "Enter the amount to approve." : minor === null ? `Enter an amount with at most ${decimals} decimal places.` : minor < BigInt(1) ? "The amount must be more than zero." : minor > BigInt(claim.claimed.amount_minor) ? `The most you can approve is ${formatMoney(claim.claimed)}, the amount claimed.` : null;
  const invalid = note.trim() === "" || amountError !== null;

  async function confirm() {
    setPending(true);
    const ok = await onDecide(choice === "approve" ? { decision: "approve", approved_amount: amount.trim(), note: note.trim() } : { decision: "reject", note: note.trim() });
    setPending(false);
    if (!ok) setConfirming(false);
  }

  return (
    <section aria-labelledby="decision-heading" className="space-y-3 rounded-md border border-foreground/20 p-4">
      <h2 id="decision-heading" className="text-lg font-semibold">Decision</h2>
      <fieldset className="flex flex-wrap gap-4" disabled={confirming}>
        <legend className="sr-only">Decision</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="decision" className="size-5" checked={choice === "approve"} onChange={() => setChoice("approve")} />Approve</label>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="decision" className="size-5" checked={choice === "reject"} onChange={() => setChoice("reject")} />Reject</label>
      </fieldset>
      {choice === "approve" ? <TextField label={`Amount to approve (${claim.claimed.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount !== claim.claimed.amount ? amountError : null} disabled={confirming} /> : null}
      <div>
        <label htmlFor="decision-note" className="mb-1 block text-sm font-medium">Reason (the customer will read this)</label>
        <textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={3000} disabled={confirming} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
      </div>
      {confirming ? (
        <div role="group" aria-label="Confirm decision" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>{choice === "approve" ? `Approve ${formatMoney({ ...claim.claimed, amount: amount.trim() })}?` : "Reject this claim?"} This can&apos;t be undone.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={confirm}>{choice === "approve" ? "Yes, approve" : "Yes, reject"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : (
        <Button type="button" disabled={invalid} onClick={() => setConfirming(true)}>Review decision</Button>
      )}
    </section>
  );
}

function Payout({ claim, decimals, onPay }: { claim: AdminClaim; decimals: number; onPay: (p: { method: "refund" | "manual"; reference?: string }, key: string) => Promise<boolean> }) {
  const [method, setMethod] = useState<"refund" | "manual">("refund");
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const key = useRef<{ for: string; value: string }>({ for: "", value: "" });
  const outstanding = claim.approved ? formatMinor(BigInt(claim.approved.amount_minor - (claim.paid?.amount_minor ?? 0)), decimals, claim.approved.currency) : "";

  async function pay() {
    const signature = `${method}|${reference.trim()}`;
    if (key.current.for !== signature) key.current = { for: signature, value: crypto.randomUUID() };   // the same attempt keeps its key, so a retry can't pay twice
    setPending(true);
    const ok = await onPay({ method, ...(method === "manual" ? { reference: reference.trim() } : {}) }, key.current.value);
    setPending(false);
    if (!ok) setConfirming(false);
  }

  return (
    <section aria-labelledby="payout-heading" className="space-y-3 rounded-md border border-foreground/20 p-4">
      <h2 id="payout-heading" className="text-lg font-semibold">Pay out</h2>
      <p className="text-sm">Approved: {claim.approved ? formatMoney(claim.approved) : "—"}. To pay: {outstanding}</p>
      <SelectField label="How to pay" value={method} disabled={confirming} onChange={(e) => setMethod(e.target.value as "refund" | "manual")}>
        <option value="refund">Refund to the original payment method</option>
        <option value="manual">Record a payout made another way</option>
      </SelectField>
      {method === "manual" ? <TextField label="Payment reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} disabled={confirming} hint="For example the bank transfer reference." /> : null}
      {confirming ? (
        <div role="group" aria-label="Confirm payout" className="flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>{method === "refund" ? `Refund ${outstanding} to the customer's original payment method?` : `Record a manual payout of ${outstanding}?`} Money moves once; this can&apos;t be undone.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={pay}>{pending ? "Paying…" : "Yes, pay out"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : (
        <Button type="button" disabled={method === "manual" && reference.trim() === ""} onClick={() => setConfirming(true)}>Review payout</Button>
      )}
    </section>
  );
}
