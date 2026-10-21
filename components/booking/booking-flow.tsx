"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { postalProblem } from "@/components/quote/quote-form";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import { useCurrentUser } from "@/lib/auth/session";
import { bookShipment, fetchCountries, fetchQuote, startPayment, type BookingInput } from "@/lib/shipping/api";
import { formatDays, formatMoney } from "@/lib/shipping/format";
import { rememberGuestToken } from "@/lib/shipping/guest";
import { decimalPlaces, formatMinor, toMinor } from "@/lib/shipping/money";
import type { Country, Quote, QuoteOption } from "@/lib/shipping/schemas";
import { emptyParty, PartyFields, type PartyForm } from "./party-fields";
import { paymentDestination } from "./payment-redirect";

export type ItemForm = { description: string; quantity: string; unit_value: string; hs_code: string; origin_country: string };
export type BookingDraft = {
  contactEmail: string; sender: PartyForm; recipient: PartyForm; items: ItemForm[]; deliveryInstructions: string;
  pickup: boolean; pickupDate: string; pickupStart: string; pickupEnd: string; pickupInstructions: string; terms: boolean;
};
type Errors = Record<string, string>;

const PHONE = /^\+?[0-9 ()-]{6,30}$/;

export function emptyItem(origin = ""): ItemForm {
  return { description: "", quantity: "1", unit_value: "", hs_code: "", origin_country: origin };
}

/** The declared value and its currency, as the quote recorded them. Item values must add up to it. */
export function declaredOf(quote: Quote): { minor: bigint; decimals: number; currency: string } {
  const declared = quote.shipment.declared_value;

  return declared ? { minor: BigInt(declared.amount_minor), decimals: decimalPlaces(declared.amount), currency: declared.currency } : { minor: BigInt(0), decimals: 2, currency: quote.currency };
}

/** Mirrors the API's booking rules so most mistakes are caught before sending; the API stays the authority. */
export function validateBooking(draft: BookingDraft, quote: Quote, countries: Country[], signedIn: boolean, today: string): Errors {
  const errors: Errors = {};
  const byCode = (code: string) => countries.find((c) => c.code === code);

  if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contactEmail.trim())) errors.contact_email = "Enter an email address so we can send your confirmation and tracking number.";

  for (const role of ["sender", "recipient"] as const) {
    const party = draft[role];
    const country = byCode(party.country);
    if (party.name.trim() === "") errors[`${role}.name`] = "Enter a name.";
    if (!PHONE.test(party.phone.trim())) errors[`${role}.phone`] = "Enter a phone number with the country code.";
    if (party.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.email.trim())) errors[`${role}.email`] = "Enter a valid email address.";
    if (party.line1.trim() === "") errors[`${role}.line1`] = "Enter the street address.";
    if (party.city.trim() === "") errors[`${role}.city`] = "Enter a city.";
    if (country?.state_required && party.state.trim() === "") errors[`${role}.state`] = `${(country.state_label ?? "State").replace(/\s*\(optional\)/i, "")} is required for this country.`;
    const postal = postalProblem(country, party.postal_code);
    if (postal) errors[`${role}.postal_code`] = postal;
  }

  const declared = declaredOf(quote);
  let total = BigInt(0);

  draft.items.forEach((item, i) => {
    if (item.description.trim() === "") errors[`items.${i}.description`] = "Describe the item.";
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) errors[`items.${i}.quantity`] = "Enter a whole number of 1 or more.";
    const value = toMinor(item.unit_value, declared.decimals);

    if (value === null) errors[`items.${i}.unit_value`] = `Enter a value with at most ${declared.decimals} decimal places.`;
    else if (!errors[`items.${i}.quantity`]) total += value * BigInt(quantity);

    if (item.hs_code.trim() !== "" && !/^\d{4,10}(\.\d+)?$/.test(item.hs_code.trim())) errors[`items.${i}.hs_code`] = "Use 4 to 10 digits, for example 6205.";
    if (item.origin_country === "") errors[`items.${i}.origin_country`] = "Choose where it was made.";
  });

  if (declared.minor > BigInt(0) && !Object.keys(errors).some((k) => k.startsWith("items.")) && total !== declared.minor) {
    errors.items = `The items add up to ${formatMinor(total, declared.decimals, declared.currency)}, but you declared ${formatMinor(declared.minor, declared.decimals, declared.currency)} when you asked for prices. They must match.`;
  }

  if (draft.pickup) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.pickupDate) || draft.pickupDate < today) errors["pickup.date"] = "Choose today or a later date.";
    if (!/^\d{2}:\d{2}$/.test(draft.pickupStart)) errors["pickup.window_start"] = "Choose a start time.";
    if (!/^\d{2}:\d{2}$/.test(draft.pickupEnd)) errors["pickup.window_end"] = "Choose an end time.";
    else if (draft.pickupStart && draft.pickupEnd <= draft.pickupStart) errors["pickup.window_end"] = "The end must be after the start.";
  }

  if (!draft.terms) errors.terms_accepted = "You must accept the terms to book.";

  return errors;
}

export function toBookingInput(draft: BookingDraft, quote: Quote, optionId: string, signedIn: boolean): BookingInput {
  const party = (p: PartyForm) => ({
    name: p.name.trim(), phone: p.phone.trim(), line1: p.line1.trim(), city: p.city.trim(), country: p.country,
    ...(p.company.trim() ? { company: p.company.trim() } : {}), ...(p.email.trim() ? { email: p.email.trim() } : {}), ...(p.line2.trim() ? { line2: p.line2.trim() } : {}),
    ...(p.state.trim() ? { state: p.state.trim() } : {}), ...(p.postal_code.trim() ? { postal_code: p.postal_code.trim() } : {}),
  });

  return {
    quote_id: quote.id, option_id: optionId, ...(!signedIn || draft.contactEmail.trim() ? { contact_email: draft.contactEmail.trim() } : {}),
    sender: party(draft.sender), recipient: party(draft.recipient),
    items: draft.items.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity), unit_value: i.unit_value.trim(), origin_country: i.origin_country, ...(i.hs_code.trim() ? { hs_code: i.hs_code.trim() } : {}) })),
    ...(draft.pickup ? { pickup: { date: draft.pickupDate, window_start: draft.pickupStart, window_end: draft.pickupEnd, ...(draft.pickupInstructions.trim() ? { instructions: draft.pickupInstructions.trim() } : {}) } } : {}),
    ...(draft.deliveryInstructions.trim() ? { delivery_instructions: draft.deliveryInstructions.trim() } : {}),
    terms_accepted: draft.terms,
  };
}

export function BookingFlow({ quoteId }: { quoteId: string }) {
  const optionId = useSearchParams().get("option") ?? "";
  const quote = useQuery({ queryKey: ["quote", quoteId], queryFn: ({ signal }) => fetchQuote(quoteId, signal), retry: false });
  const countries = useQuery({ queryKey: ["countries"], queryFn: fetchCountries, staleTime: 60 * 60_000, retry: false });

  if (quote.isPending || countries.isPending) return <p role="status">Loading your booking…</p>;

  if (quote.isError || countries.isError) {
    const missing = quote.error instanceof ApiError && quote.error.status === 404;

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this quote." : "We couldn't load your booking right now."}</p>
        <Link href="/quote" className={buttonVariants({ size: "sm", className: "mt-3" })}>Start a new quote</Link>
      </div>
    );
  }

  const option = quote.data.options.find((o) => o.id === optionId);
  const expired = quote.data.status === "expired";

  if (!option || expired) {
    return (
      <div role="alert" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950">
        <p>{expired ? "These prices have expired, so this booking can't go ahead." : "We couldn't find the option you chose."}</p>
        <Link href={expired ? "/quote" : `/quote/${encodeURIComponent(quoteId)}`} className={buttonVariants({ size: "sm", className: "mt-3" })}>{expired ? "Get new prices" : "Back to the prices"}</Link>
      </div>
    );
  }

  return <BookingForm quote={quote.data} option={option} countries={countries.data} />;
}

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BookingForm({ quote, option, countries }: { quote: Quote; option: QuoteOption; countries: Country[] }) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const signedIn = Boolean(user);
  const declared = declaredOf(quote);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<BookingDraft>(() => ({
    contactEmail: "", sender: emptyParty(quote.shipment.origin.country, quote.shipment.origin.city, quote.shipment.origin.postal ?? ""),
    recipient: emptyParty(quote.shipment.destination.country, quote.shipment.destination.city, quote.shipment.destination.postal ?? ""),
    items: [{ ...emptyItem(quote.shipment.origin.country), description: quote.shipment.contents, unit_value: declared.minor > BigInt(0) ? quote.shipment.declared_value?.amount ?? "" : "" }],
    deliveryInstructions: "", pickup: false, pickupDate: today, pickupStart: "09:00", pickupEnd: "17:00", pickupInstructions: "", terms: false,
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per distinct request: a double click or retry of the same booking can never create a second shipment.
  const keyRef = useRef<{ body: string; key: string } | null>(null);

  const itemTotal = draft.items.reduce((sum, i) => {
    const value = toMinor(i.unit_value, declared.decimals);
    const quantity = Number(i.quantity);

    return value !== null && Number.isInteger(quantity) && quantity > 0 ? sum + value * BigInt(quantity) : sum;
  }, BigInt(0));
  const setItem = (index: number, field: keyof ItemForm) => (event: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === index ? { ...it, [field]: event.target.value } : it)) }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problems = validateBooking(draft, quote, countries, signedIn, today);
    setErrors(problems);

    if (Object.keys(problems).length > 0) {
      setFormError("Please check the highlighted fields.");

      return;
    }

    const input = toBookingInput(draft, quote, option.id, signedIn);
    const body = JSON.stringify(input);
    if (keyRef.current?.body !== body) keyRef.current = { body, key: newKey() };
    setPending(true);

    let shipmentId: string;

    try {
      const shipment = await bookShipment(input, keyRef.current.key);
      shipmentId = shipment.id;
      if (shipment.guest_access_token) rememberGuestToken(shipment.id, shipment.guest_access_token);

      if (!shipment.payment.requires_payment) {
        router.push(`/shipments/${encodeURIComponent(shipment.id)}`);

        return;
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors(Object.fromEntries(Object.entries(caught.fieldErrors).map(([field, messages]) => [field, messages[0]])));
        setFormError("Please check the highlighted fields.");
      } else if (caught instanceof ApiError && caught.code === "quote_expired") {
        setFormError("These prices have just expired. Please get a new quote.");
      } else {
        setFormError(describeError(caught));
      }
      setPending(false);

      return;
    }

    try {
      const payment = await startPayment(shipmentId, newKey());
      const destination = paymentDestination(payment.action?.url ?? null, shipmentId, window.location.origin);

      if (destination.kind === "external") window.location.assign(destination.url);
      else router.push(destination.path);
    } catch {
      // The booking exists; payment can be retried from the shipment page.
      router.push(`/shipments/${encodeURIComponent(shipmentId)}?payment=error`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <section aria-label="Your choice" className="rounded-md border border-foreground/20 p-4">
        <p className="text-sm opacity-80">You&apos;re booking</p>
        <p className="text-xl font-semibold">{option.service.name}</p>
        <p className="text-sm">Delivery in {formatDays(option.estimated_delivery)} (estimate) · <strong>{formatMoney(option.totals.total)}</strong> to pay now</p>
        {option.service.is_demo ? <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">Demonstration service: no real parcel will move</p> : null}
        <p className="mt-2 text-sm"><Link href={`/quote/${encodeURIComponent(quote.id)}`} className="underline">Choose a different option</Link></p>
      </section>

      <FormAlert message={formError} />

      {!signedIn ? (
        <section className="space-y-3">
          <TextField label="Your email" type="email" autoComplete="email" value={draft.contactEmail} onChange={(e) => setDraft((d) => ({ ...d, contactEmail: e.target.value }))} error={errors.contact_email} hint="We'll send your confirmation and tracking number here." required />
          <p className="text-sm">Already have an account? <Link href={`/login?next=${encodeURIComponent(`/book/${quote.id}?option=${option.id}`)}`} className="underline">Sign in</Link> to keep this booking with your account.</p>
        </section>
      ) : null}

      <PartyFields prefix="sender" legend="Sender (collection address)" value={draft.sender} onChange={(sender) => setDraft((d) => ({ ...d, sender }))} errors={errors} countries={countries} />
      <PartyFields prefix="recipient" legend="Recipient (delivery address)" value={draft.recipient} onChange={(recipient) => setDraft((d) => ({ ...d, recipient }))} errors={errors} countries={countries} />

      <fieldset className="space-y-4 rounded-md border border-foreground/15 p-4">
        <legend className="px-1 text-lg font-semibold">What&apos;s in the shipment</legend>
        <p className="text-sm opacity-80">
          Customs uses this list. Values are in {declared.currency}.
          {declared.minor > BigInt(0) ? ` The values must add up to ${formatMinor(declared.minor, declared.decimals, declared.currency)}, the amount you declared.` : ""}
        </p>
        {draft.items.map((item, i) => (
          <div key={i} role="group" aria-label={`Item ${i + 1}`} className="space-y-3 rounded-md bg-foreground/5 p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Item {i + 1}</h3>
              {draft.items.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}>Remove{" "}<span className="sr-only">item {i + 1}</span></Button> : null}
            </div>
            <TextField label="Description" value={item.description} onChange={setItem(i, "description")} error={errors[`items.${i}.description`]} required />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TextField label="Quantity" inputMode="numeric" value={item.quantity} onChange={setItem(i, "quantity")} error={errors[`items.${i}.quantity`]} required />
              <TextField label={`Value each (${declared.currency})`} inputMode="decimal" value={item.unit_value} onChange={setItem(i, "unit_value")} error={errors[`items.${i}.unit_value`]} required />
              <TextField label="Tariff code (optional)" inputMode="numeric" value={item.hs_code} onChange={setItem(i, "hs_code")} error={errors[`items.${i}.hs_code`]} hint="HS code, if you know it." />
              <div>
                <label htmlFor={`origin-${i}`} className="mb-1 block text-sm font-medium">Made in</label>
                <select id={`origin-${i}`} value={item.origin_country} onChange={setItem(i, "origin_country")} aria-invalid={errors[`items.${i}.origin_country`] ? true : undefined} className="h-11 w-full rounded-md border border-foreground/25 bg-background px-3 text-base">
                  <option value="">Choose</option>
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                {errors[`items.${i}.origin_country`] ? <p className="mt-1 text-sm text-red-700">{errors[`items.${i}.origin_country`]}</p> : null}
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyItem(d.sender.country)] }))}>Add another item</Button>
          <p className="text-sm" aria-live="polite">Items total: <strong>{formatMinor(itemTotal, declared.decimals, declared.currency)}</strong></p>
        </div>
        {errors.items ? <p role="alert" className="text-sm text-red-700">{errors.items}</p> : null}
      </fieldset>

      <fieldset className="space-y-4 rounded-md border border-foreground/15 p-4">
        <legend className="px-1 text-lg font-semibold">Collection and delivery</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.pickup} onChange={(e) => setDraft((d) => ({ ...d, pickup: e.target.checked }))} />
          Collect the shipment from the sender&apos;s address
        </label>
        {draft.pickup ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Date" type="date" min={today} value={draft.pickupDate} onChange={(e) => setDraft((d) => ({ ...d, pickupDate: e.target.value }))} error={errors["pickup.date"]} required />
            <TextField label="Between" type="time" value={draft.pickupStart} onChange={(e) => setDraft((d) => ({ ...d, pickupStart: e.target.value }))} error={errors["pickup.window_start"]} required />
            <TextField label="and" type="time" value={draft.pickupEnd} onChange={(e) => setDraft((d) => ({ ...d, pickupEnd: e.target.value }))} error={errors["pickup.window_end"]} required />
            <div className="sm:col-span-3"><TextField label="Collection instructions (optional)" value={draft.pickupInstructions} onChange={(e) => setDraft((d) => ({ ...d, pickupInstructions: e.target.value }))} error={errors["pickup.instructions"]} /></div>
          </div>
        ) : null}
        <TextField label="Delivery instructions (optional)" value={draft.deliveryInstructions} onChange={(e) => setDraft((d) => ({ ...d, deliveryInstructions: e.target.value }))} error={errors.delivery_instructions} hint="For example: leave with reception." />
      </fieldset>

      <section className="space-y-3" aria-label="Payment">
        <h2 className="text-lg font-semibold">Payment</h2>
        <p className="text-sm">You pay <strong>{formatMoney(option.totals.total)}</strong> now. Import duties and taxes of about {formatMoney(option.totals.estimated_duties_and_import_taxes)} are estimates, are not in this total, and are paid separately if customs charges them.</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={draft.terms} onChange={(e) => setDraft((d) => ({ ...d, terms: e.target.checked }))} aria-invalid={errors.terms_accepted ? true : undefined} />
          <span>I accept the terms of carriage and confirm that the description and values above are accurate.</span>
        </label>
        {errors.terms_accepted ? <p className="text-sm text-red-700">{errors.terms_accepted}</p> : null}
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">{pending ? "Booking…" : `Book and pay ${formatMoney(option.totals.total)}`}</Button>
      </section>
    </form>
  );
}
