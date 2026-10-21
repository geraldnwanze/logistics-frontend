"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { fetchCountries, fetchQuote } from "@/lib/shipping/api";
import { countryName, describeUnavailable, formatDays, formatKg, formatMoney } from "@/lib/shipping/format";
import type { Quote, QuoteOption } from "@/lib/shipping/schemas";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function QuoteResults({ id }: { id: string }) {
  const quote = useQuery({ queryKey: ["quote", id], queryFn: ({ signal }) => fetchQuote(id, signal), retry: false });
  const countries = useQuery({ queryKey: ["countries"], queryFn: fetchCountries, staleTime: 60 * 60_000, retry: false });

  if (quote.isPending) return <p role="status">Loading your prices…</p>;

  if (quote.isError) {
    const missing = quote.error instanceof ApiError && quote.error.status === 404;

    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>{missing ? "We couldn't find this quote. The link may be wrong." : "We couldn't load this quote right now."}</p>
        <div className="mt-3 flex gap-2">
          {missing ? null : <Button size="sm" variant="outline" onClick={() => void quote.refetch()}>Try again</Button>}
          <Link href="/quote" className={buttonVariants({ size: "sm" })}>Start a new quote</Link>
        </div>
      </div>
    );
  }

  return <QuoteView quote={quote.data} countries={countries.data} />;
}

export function QuoteView({ quote, countries }: { quote: Quote; countries?: { code: string; name: string }[] }) {
  const [now] = useState(() => Date.now());   // fixed when the page opens, so the verdict does not flip while it is read
  const expired = quote.status === "expired" || new Date(quote.expires_at).getTime() < now;
  const { origin, destination } = quote.shipment;

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <strong>{origin.city}, {countryName(origin.country, countries)}</strong> to <strong>{destination.city}, {countryName(destination.country, countries)}</strong>
        {" · "}{quote.shipment.package_count} package{quote.shipment.package_count === 1 ? "" : "s"}{" · "}{quote.shipment.contents}
      </p>

      {expired ? (
        <div role="alert" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-amber-950">
          <p>These prices have expired. Prices can change, so please get a new quote.</p>
          <Link href="/quote" className={buttonVariants({ className: "mt-3" })}>Get new prices</Link>
        </div>
      ) : (
        <p className="text-sm opacity-80">Prices are held until {formatWhen(quote.expires_at)}.</p>
      )}

      {quote.options.length === 0 ? (
        <div role="status" className="rounded-md border border-foreground/20 p-4">
          <p>None of our services can carry this shipment as described.</p>
          <Link href="/quote" className="mt-2 inline-block underline">Change the details</Link>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Shipping options">
          {quote.options.map((option) => <OptionCard key={option.id} option={option} quoteId={quote.id} expired={expired} />)}
        </ul>
      )}

      {quote.unavailable.length > 0 ? (
        <details className="rounded-md border border-foreground/15 p-4 text-sm">
          <summary className="cursor-pointer font-medium">Services that can&apos;t carry this shipment ({quote.unavailable.length})</summary>
          <ul className="mt-3 space-y-2">
            {quote.unavailable.map((u) => (
              <li key={u.service}><strong>{u.name}</strong>: {u.reasons.map(describeUnavailable).join(" ")}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function OptionCard({ option, quoteId, expired }: { option: QuoteOption; quoteId: string; expired: boolean }) {
  const duties = option.totals.estimated_duties_and_import_taxes;
  const showDuties = duties.amount_minor > 0;

  return (
    <li className="rounded-md border border-foreground/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{option.service.name}</h2>
          <p className="text-sm opacity-80">Delivery in {formatDays(option.estimated_delivery)} (estimate)</p>
          {option.service.is_demo ? <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">Demonstration service: sample prices, not a real carrier</p> : null}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold" aria-label={`Total ${formatMoney(option.totals.total)}`}>{formatMoney(option.totals.total)}</p>
          <p className="text-xs opacity-75">total to pay now</p>
        </div>
      </div>

      {showDuties ? (
        <p className="mt-3 rounded bg-foreground/5 p-2 text-sm">
          Not included: estimated import duties and taxes of about <strong>{formatMoney(duties)}</strong>. Customs sets the real amount, and you pay it separately.
        </p>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">How this price is made up</summary>
        <table className="mt-2 w-full">
          <caption className="sr-only">Price breakdown for {option.service.name}</caption>
          <tbody>
            {option.line_items.map((line) => (
              <tr key={line.code} className="border-t border-foreground/10">
                <th scope="row" className="py-1 text-left font-normal">{line.label}{line.is_estimate ? " — estimate, not in the total" : ""}</th>
                <td className="py-1 text-right">{formatMoney(line.amount)}</td>
              </tr>
            ))}
            {option.totals.tax.amount_minor > 0 ? (
              <tr className="border-t border-foreground/10"><th scope="row" className="py-1 text-left font-normal">Tax</th><td className="py-1 text-right">{formatMoney(option.totals.tax)}</td></tr>
            ) : null}
            <tr className="border-t border-foreground/30 font-semibold"><th scope="row" className="py-1 text-left">Total</th><td className="py-1 text-right">{formatMoney(option.totals.total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 opacity-80">
          Billed on {formatKg(option.weights.billable_g)}: actual {formatKg(option.weights.actual_g)}, volumetric {formatKg(option.weights.volumetric_g)} (size ÷ {option.weights.volumetric_divisor}); the larger is used.
        </p>
        {option.exchange_rate ? <p className="mt-1 opacity-80">Converted from {option.exchange_rate.from} to {option.exchange_rate.to} at {option.exchange_rate.rate}{option.exchange_rate.source ? ` (${option.exchange_rate.source})` : ""}.</p> : null}
        {option.required_documents.length > 0 ? <p className="mt-1">You will need: {option.required_documents.join(", ")}.</p> : null}
        {option.restrictions.length > 0 ? <ul className="mt-1 list-disc pl-5">{option.restrictions.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        {option.assumptions.length > 0 ? <ul className="mt-1 list-disc pl-5 opacity-80">{option.assumptions.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      </details>

      <div className="mt-4">
        {expired ? (
          <Button disabled>Prices expired</Button>
        ) : (
          <Link href={`/book/${encodeURIComponent(quoteId)}?option=${encodeURIComponent(option.id)}`} className={buttonVariants()}>Book {option.service.name}</Link>
        )}
      </div>
    </li>
  );
}
