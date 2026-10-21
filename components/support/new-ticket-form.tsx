"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { useCurrentUser } from "@/lib/auth/session";
import { normaliseTrackingNumber } from "@/lib/tracking/api";
import { openTicket } from "@/lib/support/api";
import { CATEGORY_LABELS } from "@/lib/support/labels";
import { TICKET_CATEGORIES } from "@/lib/support/schemas";
import { rememberTicketToken } from "@/lib/support/tokens";
import { AttachmentPicker } from "./attachment-picker";

export const ATTACHMENT_ERRORS = ["unsupported_attachment", "too_many_attachments", "attachment_too_large", "invalid_attachment"];

type Values = { category: string; tracking: string; subject: string; message: string; email: string };
type Errors = Partial<Record<keyof Values, string>>;

export function validateTicket(values: Values, signedIn: boolean): Errors {
  const errors: Errors = {};
  if (values.subject.trim() === "") errors.subject = "Tell us briefly what this is about.";
  else if (values.subject.length > 200) errors.subject = "Use at most 200 characters.";
  if (values.message.trim() === "") errors.message = "Describe how we can help.";
  else if (values.message.length > 5000) errors.message = "Use at most 5,000 characters.";
  if (values.tracking.trim() !== "" && !/^[A-Za-z0-9-\s]{6,40}$/.test(values.tracking.trim())) errors.tracking = "A tracking number is 6 to 40 letters, numbers or dashes.";
  if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter an email address so we can reply to you.";

  return errors;
}

export function NewTicketForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: user } = useCurrentUser();
  const signedIn = Boolean(user);
  const requestedCategory = params.get("category") ?? "";
  const [values, setValues] = useState<Values>({
    category: (TICKET_CATEGORIES as readonly string[]).includes(requestedCategory) ? requestedCategory : params.get("shipment") ? "shipment" : "general",
    tracking: (params.get("shipment") ?? "").slice(0, 40), subject: "", message: "", email: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const set = (field: keyof Values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problems = validateTicket(values, signedIn);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setPending(true);

    try {
      const ticket = await openTicket({
        subject: values.subject.trim(), category: values.category, message: values.message.trim(),
        ...(values.tracking.trim() ? { tracking_number: normaliseTrackingNumber(values.tracking) } : {}), ...(!signedIn ? { email: values.email.trim() } : {}),
      }, params.get("ref") ?? undefined, files);
      if (ticket.access_token) rememberTicketToken(ticket.id, ticket.access_token);
      // The page stays mounted (hidden) after navigating, so don't leave the message sitting in it.
      setValues((current) => ({ ...current, subject: "", message: "" }));
      setFiles([]);
      router.push(`/support/tickets/${encodeURIComponent(ticket.id)}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors({ subject: caught.field("subject"), message: caught.field("message"), email: caught.field("email"), tracking: caught.field("tracking_number"), category: caught.field("category") });
      } else if (caught instanceof ApiError && ATTACHMENT_ERRORS.includes(caught.code)) {
        setFormError(caught.message);
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert message={formError} />
      <SelectField label="What is this about?" value={values.category} onChange={set("category")} error={errors.category}>
        {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
      </SelectField>
      <TextField label="Tracking number (optional)" value={values.tracking} onChange={set("tracking")} error={errors.tracking} hint="If this is about a shipment on your account, add its tracking number." autoComplete="off" />
      <TextField label="Subject" value={values.subject} onChange={set("subject")} error={errors.subject} maxLength={200} required />
      <div>
        <label htmlFor="ticket-message" className="mb-1 block text-sm font-medium">How can we help?</label>
        <textarea id="ticket-message" value={values.message} onChange={set("message")} rows={6} maxLength={5000} required aria-invalid={errors.message ? true : undefined} aria-describedby={errors.message ? "ticket-message-error" : undefined} className="w-full rounded-md border border-foreground/25 bg-background px-3 py-2 text-base" />
        <p className="mt-1 text-xs opacity-75">{values.message.length}/5000</p>
        {errors.message ? <p id="ticket-message-error" className="mt-1 text-sm text-red-700">{errors.message}</p> : null}
      </div>
      <AttachmentPicker files={files} onChange={setFiles} disabled={pending} />
      {!signedIn ? <TextField label="Your email" type="email" autoComplete="email" value={values.email} onChange={set("email")} error={errors.email} hint="We'll email our replies here." required /> : null}
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
