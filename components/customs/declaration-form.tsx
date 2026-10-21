"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { saveDeclaration } from "@/lib/shipping/api";
import { EXPORT_REASONS, INCOTERMS } from "@/lib/shipping/customs-labels";
import type { Declaration } from "@/lib/shipping/schemas";

type Values = { incoterm: string; reason_for_export: string; exporter_tax_id: string; consignee_tax_id: string; eori_number: string; remarks: string };
type Errors = Partial<Record<keyof Values, string>>;

const EORI = /^[A-Z]{2}[A-Z0-9]{1,15}$/;

export function toValues(declaration: Declaration | null): Values {
  return {
    incoterm: declaration?.incoterm ?? "", reason_for_export: declaration?.reason_for_export ?? "", exporter_tax_id: declaration?.exporter_tax_id ?? "",
    consignee_tax_id: declaration?.consignee_tax_id ?? "", eori_number: declaration?.eori_number ?? "", remarks: declaration?.remarks ?? "",
  };
}

export function validateDeclaration(values: Values): Errors {
  const errors: Errors = {};
  if (values.incoterm === "") errors.incoterm = "Choose a delivery term.";
  if (values.reason_for_export === "") errors.reason_for_export = "Choose the reason for sending.";
  if (values.eori_number.trim() !== "" && !EORI.test(values.eori_number.trim().toUpperCase())) errors.eori_number = "An EORI number is two letters followed by up to 15 letters or digits, for example DE123456789.";
  if (values.exporter_tax_id.length > 64) errors.exporter_tax_id = "Use at most 64 characters.";
  if (values.consignee_tax_id.length > 64) errors.consignee_tax_id = "Use at most 64 characters.";
  if (values.remarks.length > 1000) errors.remarks = "Use at most 1,000 characters.";

  return errors;
}

/** Empty optional boxes are sent as null, so clearing a field really clears it. */
export function toPayload(values: Values): Partial<Declaration> {
  const optional = (v: string) => (v.trim() === "" ? null : v.trim());

  return {
    incoterm: values.incoterm, reason_for_export: values.reason_for_export, exporter_tax_id: optional(values.exporter_tax_id),
    consignee_tax_id: optional(values.consignee_tax_id), eori_number: optional(values.eori_number.toUpperCase()), remarks: optional(values.remarks),
  };
}

export function DeclarationForm({ shipmentId, declaration, readOnly }: { shipmentId: string; declaration: Declaration | null; readOnly: boolean }) {
  const client = useQueryClient();
  const [values, setValues] = useState<Values>(() => toValues(declaration));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (field: keyof Values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setSaved(false);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);
    const problems = validateDeclaration(values);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setPending(true);

    try {
      const updated = await saveDeclaration(shipmentId, toPayload(values));
      client.setQueryData(["customs", shipmentId], updated);
      setValues(toValues(updated.declaration));
      setSaved(true);
      setSavedOnce(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors(Object.fromEntries(Object.entries(caught.fieldErrors).map(([field, messages]) => [field, messages[0]])));
      } else if (caught instanceof ApiError && caught.code === "shipment_closed") {
        setFormError("This shipment is finished, so its declaration can no longer change.");
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate aria-labelledby="declaration-heading">
      <h2 id="declaration-heading" className="text-xl font-semibold">Customs declaration</h2>
      <p className="text-sm opacity-80">Customs uses this to decide how your shipment is treated. You are responsible for it being accurate and complete.</p>
      <FormAlert message={formError} />
      {saved ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">Your declaration has been saved.</p> : null}
      <fieldset disabled={readOnly || pending} className="space-y-4">
        <SelectField label="Delivery terms (Incoterm)" value={values.incoterm} onChange={set("incoterm")} error={errors.incoterm} hint="Who arranges and pays for what, and where the risk passes. If unsure, ask the buyer or seller." required>
          <option value="">Choose…</option>
          {INCOTERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </SelectField>
        <SelectField label="Reason for sending" value={values.reason_for_export} onChange={set("reason_for_export")} error={errors.reason_for_export} required>
          <option value="">Choose…</option>
          {EXPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Sender's tax ID (optional)" value={values.exporter_tax_id} onChange={set("exporter_tax_id")} error={errors.exporter_tax_id} hint="VAT, TIN or similar." maxLength={64} />
          <TextField label="Recipient's tax ID (optional)" value={values.consignee_tax_id} onChange={set("consignee_tax_id")} error={errors.consignee_tax_id} maxLength={64} />
        </div>
        <TextField label="EORI number (optional)" value={values.eori_number} onChange={set("eori_number")} error={errors.eori_number} hint="For shipments entering the EU or UK, for example DE123456789." maxLength={17} autoCapitalize="characters" />
        <div>
          <label htmlFor="declaration-remarks" className="mb-1 block text-sm font-medium">Remarks (optional)</label>
          <textarea id="declaration-remarks" value={values.remarks} onChange={set("remarks")} rows={3} maxLength={1000} aria-invalid={errors.remarks ? true : undefined} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
          {errors.remarks ? <p className="mt-1 text-sm text-red-700">{errors.remarks}</p> : null}
        </div>
        {readOnly ? null : <Button type="submit" disabled={pending}>{pending ? "Saving…" : declaration || savedOnce ? "Update declaration" : "Save declaration"}</Button>}
      </fieldset>
      {readOnly ? <p className="text-sm opacity-80">This shipment is finished, so the declaration can no longer be changed.</p> : null}
    </form>
  );
}
