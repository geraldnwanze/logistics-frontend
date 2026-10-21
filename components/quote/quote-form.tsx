"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { fetchProfileOptions } from "@/lib/account/api";
import { describeError } from "@/lib/auth/errors";
import { createQuote, fetchCountries, type QuoteInput } from "@/lib/shipping/api";
import type { Country } from "@/lib/shipping/schemas";

export type Unit = "metric" | "imperial";
export type PackageForm = { type: string; weight: string; length: string; width: string; height: string };
export type Errors = Record<string, string>;
export const MAX_PACKAGES = 50;

export const FIELD_NAMES: Record<Unit, { weight: string; length: string; width: string; height: string }> = {
  metric: { weight: "weight_kg", length: "length_cm", width: "width_cm", height: "height_cm" },
  imperial: { weight: "weight_lb", length: "length_in", width: "width_in", height: "height_in" },
};

const WEIGHT = /^\d{1,5}(\.\d{1,3})?$/;
const DIMENSION: Record<Unit, RegExp> = { metric: /^\d{1,4}(\.\d)?$/, imperial: /^\d{1,4}(\.\d{1,2})?$/ };
const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

export function emptyPackage(): PackageForm {
  return { type: "box", weight: "", length: "", width: "", height: "" };
}

export function postalProblem(country: Country | undefined, postal: string): string | null {
  const value = postal.trim();
  if (!country) return null;
  if (value === "") return country.postal_code_required ? "A postal code is required for this country." : null;

  try {
    return country.postal_code_pattern && !new RegExp(country.postal_code_pattern, "i").test(value) ? "This postal code format is not valid for the selected country." : null;
  } catch {
    return null; // an unreadable pattern must never block a customer; the API still checks
  }
}

export type QuoteDraft = {
  origin: { country: string; city: string; postal: string };
  destination: { country: string; city: string; postal: string };
  type: QuoteInput["shipment_type"];
  contents: string;
  unit: Unit;
  packages: PackageForm[];
  declaredAmount: string;
  declaredCurrency: string;
  insurance: boolean;
};

/** The same checks the API makes, using the API's field names so server and client errors line up. */
export function validateQuote(draft: QuoteDraft, countries: Country[]): Errors {
  const errors: Errors = {};
  const byCode = (code: string) => countries.find((c) => c.code === code);

  for (const side of ["origin", "destination"] as const) {
    const place = draft[side];
    if (!place.country) errors[`${side}.country`] = "Choose a country.";
    if (place.city.trim() === "") errors[`${side}.city`] = "Enter a city.";
    const postal = postalProblem(byCode(place.country), place.postal);
    if (postal) errors[`${side}.postal_code`] = postal;
  }

  if (draft.contents.trim() === "") errors.contents = "Describe what you are sending.";

  const names = FIELD_NAMES[draft.unit];
  draft.packages.forEach((pack, i) => {
    const checks: [keyof typeof names, string, RegExp][] = [["weight", pack.weight, WEIGHT], ["length", pack.length, DIMENSION[draft.unit]], ["width", pack.width, DIMENSION[draft.unit]], ["height", pack.height, DIMENSION[draft.unit]]];

    for (const [name, value, pattern] of checks) {
      if (!pattern.test(value.trim())) errors[`packages.${i}.${names[name]}`] = value.trim() === "" ? "Required." : "Enter a number (check the decimal places).";
      else if (Number(value) <= 0) errors[`packages.${i}.${names[name]}`] = "Must be greater than zero.";
    }
  });

  if (draft.declaredAmount.trim() !== "") {
    if (!AMOUNT.test(draft.declaredAmount.trim())) errors["declared_value.amount"] = "Enter an amount, for example 120.50.";
    if (draft.declaredCurrency === "") errors["declared_value.currency"] = "Choose a currency.";
  }

  return errors;
}

export function toQuoteInput(draft: QuoteDraft): QuoteInput {
  const names = FIELD_NAMES[draft.unit];
  const place = (p: QuoteDraft["origin"]) => ({ country: p.country, city: p.city.trim(), ...(p.postal.trim() ? { postal_code: p.postal.trim() } : {}) });

  return {
    origin: place(draft.origin), destination: place(draft.destination), shipment_type: draft.type, contents: draft.contents.trim(), unit_system: draft.unit,
    packages: draft.packages.map((p) => ({ type: p.type, [names.weight]: p.weight.trim(), [names.length]: p.length.trim(), [names.width]: p.width.trim(), [names.height]: p.height.trim() })),
    ...(draft.declaredAmount.trim() ? { declared_value: { amount: draft.declaredAmount.trim(), currency: draft.declaredCurrency } } : {}),
    insurance: draft.insurance,
  };
}

export function QuoteForm() {
  const router = useRouter();
  const countries = useQuery({ queryKey: ["countries"], queryFn: fetchCountries, staleTime: 60 * 60_000, retry: false });
  const options = useQuery({ queryKey: ["profile-options"], queryFn: fetchProfileOptions, staleTime: 5 * 60_000, retry: false });
  const [draft, setDraft] = useState<QuoteDraft>({
    origin: { country: "", city: "", postal: "" }, destination: { country: "", city: "", postal: "" }, type: "parcel", contents: "", unit: "metric",
    packages: [emptyPackage()], declaredAmount: "", declaredCurrency: "USD", insurance: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const countryList = countries.data ?? [];
  const names = FIELD_NAMES[draft.unit];

  const place = (side: "origin" | "destination", field: "country" | "city" | "postal") => (event: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [side]: { ...d[side], [field]: event.target.value } }));
  const pack = (index: number, field: keyof PackageForm) => (event: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, packages: d.packages.map((p, i) => (i === index ? { ...p, [field]: event.target.value } : p)) }));

  function switchUnit(unit: Unit) {
    // Numbers typed in one system must never be silently reinterpreted in the other, so the measurements are cleared.
    setDraft((d) => ({ ...d, unit, packages: d.packages.map((p) => ({ ...p, weight: "", length: "", width: "", height: "" })) }));
    setErrors({});
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problems = validateQuote(draft, countryList);
    setErrors(problems);

    if (Object.keys(problems).length > 0) {
      setFormError("Please check the highlighted fields.");

      return;
    }

    setPending(true);

    try {
      const quote = await createQuote(toQuoteInput(draft));
      router.push(`/quote/${encodeURIComponent(quote.id)}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors(Object.fromEntries(Object.entries(caught.fieldErrors).map(([field, messages]) => [field, messages[0]])));
        setFormError("Please check the highlighted fields.");
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  if (countries.isError) {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>We couldn&apos;t load the list of countries, so we can&apos;t price a shipment right now.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void countries.refetch()}>Try again</Button>
      </div>
    );
  }

  const currencies = options.data?.currencies ?? [{ code: "USD", name: "US Dollar", symbol: "$" }];

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <FormAlert message={formError} />

      {(["origin", "destination"] as const).map((side) => (
        <fieldset key={side} className="space-y-4 rounded-md border border-foreground/15 p-4">
          <legend className="px-1 text-lg font-semibold">{side === "origin" ? "Sending from" : "Sending to"}</legend>
          <SelectField label="Country" value={draft[side].country} onChange={place(side, "country")} error={errors[`${side}.country`]} disabled={countries.isPending} required>
            <option value="">{countries.isPending ? "Loading…" : "Choose a country"}</option>
            {countryList.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="City" value={draft[side].city} onChange={place(side, "city")} error={errors[`${side}.city`]} autoComplete={side === "origin" ? "address-level2" : "off"} required />
            <TextField
              label="Postal code" value={draft[side].postal} onChange={place(side, "postal")} error={errors[`${side}.postal_code`]}
              hint={countryList.find((c) => c.code === draft[side].country)?.postal_code_required ? "Required for this country." : "Optional for this country."}
            />
          </div>
        </fieldset>
      ))}

      <fieldset className="space-y-4 rounded-md border border-foreground/15 p-4">
        <legend className="px-1 text-lg font-semibold">What are you sending?</legend>
        <SelectField label="Type" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as QuoteDraft["type"] }))}>
          <option value="parcel">Parcel</option>
          <option value="document">Documents</option>
          <option value="freight">Freight</option>
        </SelectField>
        <TextField label="Contents" value={draft.contents} onChange={(e) => setDraft((d) => ({ ...d, contents: e.target.value }))} error={errors.contents} hint="For example: clothing samples. This is shown to customs." required />

        <div role="radiogroup" aria-label="Units" className="flex gap-4 text-sm">
          {(["metric", "imperial"] as const).map((unit) => (
            <label key={unit} className="flex items-center gap-2">
              <input type="radio" name="unit" checked={draft.unit === unit} onChange={() => switchUnit(unit)} />
              {unit === "metric" ? "Kilograms and centimetres" : "Pounds and inches"}
            </label>
          ))}
        </div>

        {draft.packages.map((p, i) => (
          <div key={i} className="space-y-3 rounded-md bg-foreground/5 p-3" role="group" aria-label={`Package ${i + 1}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Package {i + 1}</h3>
              {draft.packages.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, packages: d.packages.filter((_, j) => j !== i) }))}>Remove{" "}<span className="sr-only">package {i + 1}</span></Button>
              ) : null}
            </div>
            <SelectField label="Package type" value={p.type} onChange={pack(i, "type")}>
              {["box", "envelope", "tube", "pallet", "other"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </SelectField>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TextField label={draft.unit === "metric" ? "Weight (kg)" : "Weight (lb)"} inputMode="decimal" value={p.weight} onChange={pack(i, "weight")} error={errors[`packages.${i}.${names.weight}`]} required />
              <TextField label={draft.unit === "metric" ? "Length (cm)" : "Length (in)"} inputMode="decimal" value={p.length} onChange={pack(i, "length")} error={errors[`packages.${i}.${names.length}`]} required />
              <TextField label={draft.unit === "metric" ? "Width (cm)" : "Width (in)"} inputMode="decimal" value={p.width} onChange={pack(i, "width")} error={errors[`packages.${i}.${names.width}`]} required />
              <TextField label={draft.unit === "metric" ? "Height (cm)" : "Height (in)"} inputMode="decimal" value={p.height} onChange={pack(i, "height")} error={errors[`packages.${i}.${names.height}`]} required />
            </div>
          </div>
        ))}
        {draft.packages.length < MAX_PACKAGES ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, packages: [...d.packages, emptyPackage()] }))}>Add another package</Button>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4 rounded-md border border-foreground/15 p-4">
        <legend className="px-1 text-lg font-semibold">Value and cover</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Declared value (optional)" inputMode="decimal" value={draft.declaredAmount} onChange={(e) => setDraft((d) => ({ ...d, declaredAmount: e.target.value }))} error={errors["declared_value.amount"]} hint="The value of the goods. Used for customs and insurance." />
          <SelectField label="Currency" value={draft.declaredCurrency} onChange={(e) => setDraft((d) => ({ ...d, declaredCurrency: e.target.value }))} error={errors["declared_value.currency"]}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </SelectField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.insurance} onChange={(e) => setDraft((d) => ({ ...d, insurance: e.target.checked }))} />
          Add insurance for the declared value
        </label>
      </fieldset>

      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">{pending ? "Getting prices…" : "Get prices"}</Button>
    </form>
  );
}
