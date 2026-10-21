"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { addShipmentNote, addTrackingEvent, assignShipment, fetchAdminShipment, fetchShipmentAssignees, type Party, type ShipmentDetail, type TrackingUpdate } from "@/lib/admin/shipments";
import { can, EVENT_SOURCE_LABELS } from "@/lib/admin/labels";
import type { User } from "@/lib/auth/schemas";
import { describeError } from "@/lib/auth/errors";
import { DOCUMENT_LABELS } from "@/lib/shipping/customs-labels";
import { fetchDocumentLink } from "@/lib/shipping/api";
import { openSignedLink } from "@/lib/shipping/download";
import { formatDate, formatMoney, statusTone } from "@/lib/shipping/format";
import { decimalPlaces, formatMinor } from "@/lib/shipping/money";
import { AdminProblem } from "./admin-shell";
import { CompliancePanel, CustomsPanel } from "./customs-panels";
import { CancelPanel, ProofUpload, RefundPanel } from "./shipment-actions";
import { TrackingUpdateForm } from "./tracking-update-form";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function PartyCard({ title, party }: { title: string; party: Party | null }) {
  if (!party) return null;

  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      {"redacted" in party ? (
        <p className="text-sm">{party.city}, {party.country}<br /><span className="opacity-75">Contact details are hidden for your role.</span></p>
      ) : (
        <address className="text-sm not-italic">
          {party.name}{party.company ? `, ${party.company}` : ""}<br />
          {party.line1}{party.line2 ? `, ${party.line2}` : ""}<br />
          {party.city}{party.state ? `, ${party.state}` : ""} {party.postal_code}, {party.country}<br />
          {party.phone}{party.email ? <> · <a className="underline" href={`mailto:${party.email}`}>{party.email}</a></> : null}
        </address>
      )}
    </div>
  );
}

export function ShipmentDetailView({ id, user }: { id: string; user: User }) {
  const client = useQueryClient();
  const shipment = useQuery({ queryKey: ["admin-shipment", id], queryFn: ({ signal }) => fetchAdminShipment(id, signal), retry: false, refetchInterval: 60_000 });
  const people = useQuery({ queryKey: ["admin-shipment-assignees"], queryFn: ({ signal }) => fetchShipmentAssignees(signal), enabled: can(user, "shipments.assign"), staleTime: 300_000, retry: false });
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (shipment.isPending) return <p role="status">Loading the shipment…</p>;
  if (shipment.isError) return <AdminProblem error={shipment.error} what="this shipment" onRetry={() => void shipment.refetch()} />;

  const s = shipment.data;
  const decimals = decimalPlaces(s.total.amount);
  const colleagues = [...(people.data ?? [])];
  for (const known of [{ id: user.id, name: user.name }, ...(s.assignee ? [s.assignee] : [])]) if (!colleagues.some((c) => c.id === known.id)) colleagues.push(known);

  async function refresh() {
    await Promise.all([client.invalidateQueries({ queryKey: ["admin-shipment", id] }), client.invalidateQueries({ queryKey: ["admin-shipments"] })]);
  }

  async function assign(to: string | null, done: string) {
    setPending(true);
    setError(null);
    setSaved(null);

    try {
      const row = await assignShipment(id, to);
      client.setQueryData<ShipmentDetail>(["admin-shipment", id], (old) => (old ? { ...old, assigned_to: row.assigned_to, assignee: row.assignee } : old));
      await client.invalidateQueries({ queryKey: ["admin-shipments"] });
      setSaved(done);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (note.trim() === "") return;
    setPending(true);
    setError(null);
    setSaved(null);

    try {
      await addShipmentNote(id, note.trim());
      await refresh();
      setNote("");
      setSaved("Note added.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  async function track(update: TrackingUpdate) {
    setError(null);
    setSaved(null);
    await addTrackingEvent(id, update);
    await refresh();
    setSaved("Tracking updated.");
  }

  return (
    <div className="space-y-8">
      <p><Link href="/admin/shipments" className="text-sm underline">← All shipments</Link></p>
      <header>
        <h1 className="font-mono text-2xl font-semibold">{s.tracking_number}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={s.status.label} tone={statusTone(s.status.code)} />
          {s.delayed ? <StatusChip label="Running late" tone="warn" /> : null}
          {s.compliance_status === "review_required" ? <StatusChip label="On compliance hold" tone="warn" /> : s.compliance_status === "rejected" ? <StatusChip label="Rejected by compliance" tone="bad" /> : null}
          {s.is_demo ? <StatusChip label="Demonstration data" tone="plain" /> : null}
          <span>{s.service} · {s.origin.city}, {s.origin.country} → {s.destination.city}, {s.destination.country}</span>
        </p>
        <p className="mt-1 text-sm opacity-80">Created {when(s.created_at)} · {formatMoney(s.total)}{s.payment_status ? ` · payment ${s.payment_status}` : ""}{s.customer ? ` · ${s.customer.name ?? s.customer.email}` : ""}</p>
      </header>

      <FormAlert message={error} />
      {saved ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}

      <section aria-labelledby="who-heading" className="grid gap-4 rounded-md border border-foreground/20 p-4 sm:grid-cols-2">
        <h2 id="who-heading" className="sr-only">Sender and recipient</h2>
        <PartyCard title="Sender" party={s.sender} />
        <PartyCard title="Recipient" party={s.recipient} />
      </section>

      <section aria-labelledby="contents-heading">
        <h2 id="contents-heading" className="text-lg font-semibold">What is being sent</h2>
        <p className="mt-1 text-sm">{s.contents} · billable weight {(s.billable_weight_g / 1000).toFixed(2)} kg · declared value {formatMinor(BigInt(s.declared_value.amount_minor), decimals, s.declared_value.currency)}{s.insurance_requested ? " · insured" : ""}</p>
        <ul aria-label="Packages" className="mt-2 list-disc pl-5 text-sm">
          {s.packages.map((p, i) => <li key={i}>{(p.weight_g / 1000).toFixed(2)} kg · {p.length_mm / 10} × {p.width_mm / 10} × {p.height_mm / 10} cm</li>)}
        </ul>
        {s.pickup_instructions || s.delivery_instructions ? <p className="mt-2 text-sm">{s.pickup_instructions ? <>Pickup: {s.pickup_instructions}. </> : null}{s.delivery_instructions ? <>Delivery: {s.delivery_instructions}.</> : null}</p> : null}
      </section>

      <section aria-labelledby="handling-heading" className="rounded-md border border-foreground/20 p-4">
        <h2 id="handling-heading" className="text-lg font-semibold">Handling</h2>
        {can(user, "shipments.assign") ? (
          <div className="mt-3 max-w-sm">
            <SelectField label="Assigned to" value={s.assigned_to ?? ""} disabled={pending} hint={people.isError ? "The list of colleagues couldn't be loaded." : undefined}
              onChange={(e) => void assign(e.target.value || null, e.target.value === "" ? "Unassigned." : e.target.value === user.id ? "Assigned to you." : `Assigned to ${colleagues.find((c) => c.id === e.target.value)?.name ?? "a colleague"}.`)}>
              <option value="">Nobody</option>
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.id === user.id ? `${c.name} (you)` : c.name}</option>)}
            </SelectField>
          </div>
        ) : <p className="mt-2 text-sm">{s.assignee ? `${s.assignee.name} is handling this.` : "Nobody is handling this yet."}</p>}
        {s.facility ? <p className="mt-2 text-sm">Facility: {s.facility}</p> : null}
      </section>

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-lg font-semibold">Tracking history</h2>
        {s.tracking.events.length === 0 ? <p className="mt-2 text-sm opacity-75">No updates yet.</p> : (
          <ol aria-label="Tracking events" className="mt-3 space-y-2">
            {[...s.tracking.events].reverse().map((e) => (
              <li key={e.id} className={e.applied ? "rounded-md border border-foreground/20 p-3" : "rounded-md border border-red-700/40 bg-red-50 p-3 text-red-950"}>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{e.status.label}</strong>
                  <span className="opacity-75">{when(e.occurred_at)} ({e.timezone})</span>
                  <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs">{EVENT_SOURCE_LABELS[e.source] ?? e.source}</span>
                  {!e.is_public ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-950">Staff only</span> : null}
                  {!e.applied ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs">Not applied</span> : null}
                </p>
                {e.location.city || e.location.facility ? <p className="text-sm">{[e.location.facility, e.location.city, e.location.country].filter(Boolean).join(", ")}</p> : null}
                {e.description ? <p className="text-sm">{e.description}</p> : null}
                {e.reason ? <p className="text-sm">Reason: {e.reason}</p> : null}
                {e.recipient_name ? <p className="text-sm">Received by {e.recipient_name}</p> : null}
                {e.internal_note ? <p className="mt-1 text-sm text-amber-950"><strong>Internal:</strong> {e.internal_note}</p> : null}
                {e.rejection_reason ? <p className="mt-1 text-sm">Why: {e.rejection_reason}</p> : null}
                {e.status.code === "delivered" && e.applied ? (
                  <div className="mt-2 border-t border-foreground/10 pt-2">
                    <p className="text-sm font-medium">Proof of delivery</p>
                    {s.documents.filter((d) => d.event === e.id).length === 0 ? <p className="text-sm opacity-75">Nothing attached yet.</p> : (
                      <ul aria-label="Proof of delivery files" className="mt-1 space-y-1">
                        {s.documents.filter((d) => d.event === e.id).map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="break-all">{d.name}</span>
                            <Button size="sm" variant="outline" className="min-h-11" onClick={async () => setError(await openSignedLink(() => fetchDocumentLink(id, d.id)))}>Download{" "}<span className="sr-only">{d.name}</span></Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {can(user, "tracking.create") ? <ProofUpload shipmentId={id} eventId={e.id} onDone={refresh} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <CompliancePanel shipment={s} user={user} onDone={refresh} />
      {can(user, "customs.manage") && s.tracking.international ? <CustomsPanel shipment={s} onDone={refresh} /> : null}

      {s.status.code === "cancelled" ? <p role="status" className="rounded-md border border-foreground/20 p-4 text-sm">This shipment was cancelled{s.cancellation_reason ? `: ${s.cancellation_reason}` : ""}.</p> : null}
      {s.cancellable && can(user, "shipments.update") ? <CancelPanel shipment={s} onDone={refresh} /> : null}
      {s.invoice && s.invoice.refundable_minor > 0 && can(user, "refunds.approve") ? <RefundPanel shipment={s} onDone={refresh} /> : null}

      {can(user, "tracking.create") ? (
        <section aria-labelledby="update-heading" className="rounded-md border border-foreground/20 p-4">
          <h2 id="update-heading" className="mb-3 text-lg font-semibold">Add a tracking update</h2>
          <TrackingUpdateForm allowed={s.tracking.allowed_next} onSubmit={track} />
        </section>
      ) : null}

      {s.documents.length > 0 ? (
        <section aria-labelledby="docs-heading">
          <h2 id="docs-heading" className="text-lg font-semibold">Documents</h2>
          <ul className="mt-2 space-y-2">
            {s.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/20 p-3 text-sm">
                <span><strong>{DOCUMENT_LABELS[d.type] ?? d.type.replace(/_/g, " ")}</strong> · <span className="break-all">{d.name}</span>{d.generated ? " · created by us" : ""}</span>
                <Button size="sm" variant="outline" className="min-h-11" onClick={async () => setError(await openSignedLink(() => fetchDocumentLink(id, d.id)))}>Download{" "}<span className="sr-only">{d.name}</span></Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.invoice || s.pickups.length > 0 ? (
        <section aria-labelledby="money-heading" className="text-sm">
          <h2 id="money-heading" className="text-lg font-semibold">Payment and pickup</h2>
          {s.invoice ? <p className="mt-1">Invoice {s.invoice.number}: {s.invoice.status} · refunded {formatMinor(BigInt(s.invoice.refunded_minor), decimals, s.total.currency)}</p> : null}
          {s.pickups.map((p) => <p key={p.id}>Pickup {formatDate(p.date)}: {p.status.replace(/_/g, " ")}</p>)}
        </section>
      ) : null}

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="text-lg font-semibold">Internal notes</h2>
        {s.notes.length === 0 ? <p className="mt-2 text-sm opacity-75">No notes yet.</p> : (
          <ul aria-label="Notes" className="mt-2 space-y-2">
            {s.notes.map((n) => <li key={n.id} className="rounded-md border border-amber-700/40 bg-amber-50 p-3 text-amber-950"><p className="text-xs opacity-75">{when(n.created_at)}</p><p className="whitespace-pre-wrap break-words text-sm">{n.body}</p></li>)}
          </ul>
        )}
        {can(user, "shipments.update") ? (
          <form onSubmit={addNote} aria-label="Add a note" className="mt-3 space-y-2">
            <label htmlFor="shipment-note" className="block text-sm font-medium">Add a note (never shown to the customer)</label>
            <textarea id="shipment-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
            <Button type="submit" variant="outline" disabled={pending || note.trim() === ""}>Add note</Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
