"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/pager";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { fetchCustoms, fetchDocumentLink, fetchShipment, generateCustomsPaper, removeDocument, uploadDocument } from "@/lib/shipping/api";
import { chargeAmount, DOCUMENT_LABELS, formatBytes, uploadProblem } from "@/lib/shipping/customs-labels";
import { openSignedLink } from "@/lib/shipping/download";
import type { Customs, Shipment } from "@/lib/shipping/schemas";
import { DeclarationForm } from "./declaration-form";

const CLOSED = ["delivered", "cancelled", "returned_to_sender"];

export function CustomsView({ id }: { id: string }) {
  const customs = useQuery({ queryKey: ["customs", id], queryFn: ({ signal }) => fetchCustoms(id, signal), retry: false });
  const shipment = useQuery({ queryKey: ["shipment", id], queryFn: ({ signal }) => fetchShipment(id, signal), retry: false });

  if (customs.isPending || shipment.isPending) return <p role="status">Loading customs details…</p>;

  if (customs.isError || shipment.isError) {
    const missing = [customs.error, shipment.error].some((e) => e instanceof ApiError && e.status === 404);

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this shipment. If you booked as a guest, open this page in the same browser tab you booked in." : "We couldn't load the customs details right now."}</p>
        <div className="mt-3 flex gap-2">
          {missing ? <Link href="/track" className={buttonVariants({ size: "sm" })}>Track a shipment</Link> : <Button size="sm" variant="outline" onClick={() => { void customs.refetch(); void shipment.refetch(); }}>Try again</Button>}
        </div>
      </div>
    );
  }

  return <CustomsScreen id={id} customs={customs.data} shipment={shipment.data} />;
}

export function CustomsScreen({ id, customs, shipment }: { id: string; customs: Customs; shipment: Shipment }) {
  const closed = CLOSED.includes(shipment.status);

  if (!customs.international) {
    return (
      <div className="space-y-4">
        <BackLink id={id} tracking={shipment.tracking_number} />
        <p role="status" className="rounded-md border border-foreground/20 p-4">This shipment stays within one country, so no customs paperwork is needed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <BackLink id={id} tracking={shipment.tracking_number} />
      <ComplianceBanner customs={customs} />
      <ReadinessBanner customs={customs} />
      <DeclarationForm shipmentId={id} declaration={customs.declaration} readOnly={closed} />
      <Checklist id={id} customs={customs} shipment={shipment} closed={closed} />
      <FilesOnRecord id={id} shipment={shipment} />
      <Money customs={customs} />
    </div>
  );
}

function BackLink({ id, tracking }: { id: string; tracking: string }) {
  return <p className="text-sm"><Link href={`/shipments/${encodeURIComponent(id)}`} className="underline">← Shipment <span className="font-mono">{tracking}</span></Link></p>;
}

function ComplianceBanner({ customs }: { customs: Customs }) {
  const status = customs.compliance.status;

  if (status === "review_required") {
    return <p role="status" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950"><strong>On hold for a compliance check.</strong> Something in your shipment needs a closer look before it can move. We&apos;ll email you with the outcome; you don&apos;t need to do anything yet.</p>;
  }

  if (status === "rejected") {
    return <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 p-4 text-red-950"><strong>This shipment can&apos;t be accepted.</strong>{customs.compliance.note ? ` ${customs.compliance.note}` : ""} If you paid, the booking is cancelled and refunded.</p>;
  }

  if (status === "approved") return <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-4 text-green-900">Our compliance team has reviewed and cleared this shipment.{customs.compliance.note ? ` ${customs.compliance.note}` : ""}</p>;

  return null;
}

function ReadinessBanner({ customs }: { customs: Customs }) {
  const missing = customs.requirements.filter((r) => r.direction === "export" && r.mandatory && r.status === "missing");

  if (customs.requirements.length === 0) return null;

  return missing.length === 0 ? (
    <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-4 text-green-900">Every document we need before this shipment leaves the country is on file. Customs in the destination country makes the final decision.</p>
  ) : (
    <p role="status" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950"><strong>Still needed before it can leave the country:</strong> {missing.map((r) => r.label).join(", ")}. Your shipment will be held at the origin until these are on file.</p>
  );
}

function Checklist({ id, customs, shipment, closed }: { id: string; customs: Customs; shipment: Shipment; closed: boolean }) {
  if (customs.requirements.length === 0) {
    return <section aria-labelledby="checklist-heading"><h2 id="checklist-heading" className="text-xl font-semibold">Documents</h2><p className="mt-2 text-sm">We don&apos;t require any documents for this route. Customs may still ask for some.</p></section>;
  }

  return (
    <section aria-labelledby="checklist-heading">
      <h2 id="checklist-heading" className="text-xl font-semibold">Documents we need</h2>
      <p className="mt-1 text-sm opacity-80">Based on the countries and value of this shipment. Having everything on file means our own rules are met; it doesn&apos;t guarantee customs will clear the parcel.</p>
      <ul className="mt-4 space-y-3">
        {customs.requirements.map((r) => (
          <li key={r.id} className="rounded-md border border-foreground/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{r.label}</p>
                <p className="text-sm opacity-80">{r.direction === "export" ? `Leaving ${shipment.sender?.country ?? "the origin"}` : `Entering ${shipment.recipient?.country ?? "the destination"}`}{r.mandatory ? " · required" : " · optional"}</p>
                {r.notes ? <p className="mt-1 text-sm">{r.notes}</p> : null}
              </div>
              <StatusChip label={r.status === "satisfied" ? "On file" : "Missing"} tone={r.status === "satisfied" ? "good" : r.mandatory ? "warn" : "plain"} />
            </div>
            {r.status === "missing" && r.reason ? <p className="mt-2 text-sm">{r.reason}</p> : null}
            {r.reason?.includes("HS code") ? <p className="mt-1 text-sm">Add the tariff (HS) code to each item. Items can&apos;t be changed after booking here; contact support to correct them.</p> : null}
            {closed ? null : <PaperActions id={id} type={r.document_type} hasDeclaration={customs.declaration !== null} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Upload for any document type; generation as well for the two we can build from the shipment's own data. */
function PaperActions({ id, type, hasDeclaration }: { id: string; type: string; hasDeclaration: boolean }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<"upload" | "generate" | null>(null);
  const label = DOCUMENT_LABELS[type] ?? type;
  const generatable = type === "commercial_invoice" ? "commercial-invoice" : type === "packing_list" ? "packing-list" : null;

  async function refresh() {
    await Promise.all([client.invalidateQueries({ queryKey: ["customs", id] }), client.invalidateQueries({ queryKey: ["shipment", id] })]);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const problem = uploadProblem(file);
    if (problem) return setMessage({ tone: "bad", text: problem });

    setBusy("upload");
    setMessage(null);

    try {
      await uploadDocument(id, file, type);
      setMessage({ tone: "ok", text: `${file.name} was uploaded.` });
      await refresh();
    } catch (caught) {
      const text = caught instanceof ApiError && caught.code === "unsupported_media_type" ? "We couldn't accept that file. Only genuine PDF, JPEG or PNG files are allowed."
        : caught instanceof ApiError && caught.code === "too_many_documents" ? "This shipment already has the maximum of 20 uploaded documents."
        : caught instanceof ApiError && caught.status === 422 && caught.field("file") ? caught.field("file")!
        : describeError(caught);
      setMessage({ tone: "bad", text });
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function generate() {
    if (!generatable) return;
    setBusy("generate");
    setMessage(null);
    const problem = await openSignedLink(() => generateCustomsPaper(id, generatable));
    setMessage(problem ? { tone: "bad", text: problem } : { tone: "ok", text: `${label} created from your shipment details. It's downloading.` });
    if (!problem) await refresh();
    setBusy(null);
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {generatable ? <Button size="sm" variant="outline" onClick={generate} disabled={busy !== null || !hasDeclaration}>{busy === "generate" ? "Creating…" : `Create ${label.toLowerCase()} for me`}</Button> : null}
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy !== null}>{busy === "upload" ? "Uploading…" : `Upload ${label.toLowerCase()}`}</Button>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-label={`Choose ${label.toLowerCase()} file`} onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {generatable && !hasDeclaration ? <p className="text-xs opacity-75">Save your customs declaration above first; we use it to build this document.</p> : null}
      {message ? <p role={message.tone === "bad" ? "alert" : "status"} className={message.tone === "bad" ? "text-sm text-red-900" : "text-sm text-green-900"}>{message.text}</p> : null}
    </div>
  );
}

function FilesOnRecord({ id, shipment }: { id: string; shipment: Shipment }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function remove(documentId: string) {
    setRemoving(true);
    setError(null);

    try {
      await removeDocument(id, documentId);
      await Promise.all([client.invalidateQueries({ queryKey: ["customs", id] }), client.invalidateQueries({ queryKey: ["shipment", id] })]);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "document_locked" ? caught.message : describeError(caught));
    } finally {
      setRemoving(false);
      setConfirming(null);
    }
  }

  if (shipment.documents.length === 0) return null;

  return (
    <section aria-labelledby="files-heading">
      <h2 id="files-heading" className="text-xl font-semibold">Documents on file</h2>
      <ul className="mt-3 space-y-2">
        {shipment.documents.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/20 p-3 text-sm">
            <span>
              <strong>{DOCUMENT_LABELS[doc.type] ?? doc.type}</strong> · <span className="break-all">{doc.name}</span> · {formatBytes(doc.size)}
              {doc.generated ? <span className="ml-2 rounded bg-foreground/10 px-1.5 py-0.5 text-xs">created for you</span> : null}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="min-h-11" onClick={async () => setError(await openSignedLink(() => fetchDocumentLink(id, doc.id)))}>Download{" "}<span className="sr-only">{doc.name}</span></Button>
              {doc.removable ? (
                confirming === doc.id ? (
                  <span role="group" aria-label={`Confirm removing ${doc.name}`} className="flex items-center gap-2">
                    Remove it?
                    <Button size="sm" variant="outline" className="min-h-11" disabled={removing} onClick={() => remove(doc.id)}>Yes, remove{" "}<span className="sr-only">{doc.name}</span></Button>
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirming(null)}>Keep it</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirming(doc.id)}>Remove{" "}<span className="sr-only">{doc.name}</span></Button>
                )
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="mt-2 text-sm text-red-900">{error}</p> : null}
    </section>
  );
}

function Money({ customs }: { customs: Customs }) {
  return (
    <section aria-labelledby="duties-heading" className="space-y-4">
      <h2 id="duties-heading" className="text-xl font-semibold">Duties and import taxes</h2>
      <div className="rounded-md border border-foreground/20 p-4">
        <h3 className="font-medium">Estimated</h3>
        <p className="mt-1 text-sm opacity-80">{customs.estimates.note}</p>
        {customs.estimates.items.length > 0 ? (
          <ul className="mt-2 text-sm">{customs.estimates.items.map((e, i) => <li key={i} className="flex justify-between gap-4 border-t border-foreground/10 py-1"><span>{e.label}</span><span>{chargeAmount(e.amount_minor, e.currency)}</span></li>)}</ul>
        ) : <p className="mt-2 text-sm">No estimate was made for this route.</p>}
      </div>
      <div className="rounded-md border border-foreground/20 p-4">
        <h3 className="font-medium">Charged by customs</h3>
        <p className="mt-1 text-sm opacity-80">{customs.assessed_charges.note}</p>
        {customs.assessed_charges.items.length > 0 ? (
          <ul className="mt-2 space-y-2 text-sm">
            {customs.assessed_charges.items.map((c) => (
              <li key={c.id} className="rounded bg-foreground/5 p-3">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{c.description}</span><span className="font-semibold">{chargeAmount(c.amount_minor, c.currency)}</span></div>
                <p className="opacity-80">Assessed by {c.assessed_by}{c.authority_reference ? ` · reference ${c.authority_reference}` : ""}</p>
                <p><StatusChip label={c.status === "paid" ? "Paid" : c.status === "waived" ? "Waived" : "Payable"} tone={c.status === "paid" || c.status === "waived" ? "good" : "warn"} /></p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm">Nothing has been charged by customs.</p>}
      </div>
    </section>
  );
}
