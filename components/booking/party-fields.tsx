import { SelectField, TextField } from "@/components/ui/field";
import type { Country } from "@/lib/shipping/schemas";

export type PartyForm = { name: string; company: string; phone: string; email: string; line1: string; line2: string; city: string; state: string; postal_code: string; country: string };

export function emptyParty(country = "", city = "", postal = ""): PartyForm {
  return { name: "", company: "", phone: "", email: "", line1: "", line2: "", city, state: "", postal_code: postal, country };
}

/** One address block (sender or recipient). The country is fixed by the quote: changing it would change the price. */
export function PartyFields({ prefix, legend, value, onChange, errors, countries }: {
  prefix: "sender" | "recipient"; legend: string; value: PartyForm; onChange: (next: PartyForm) => void; errors: Record<string, string>; countries: Country[];
}) {
  const country = countries.find((c) => c.code === value.country);
  const set = (field: keyof PartyForm) => (event: { target: { value: string } }) => onChange({ ...value, [field]: event.target.value });
  const error = (field: string) => errors[`${prefix}.${field}`];
  const stateLabel = country?.state_label?.replace(/\s*\(optional\)/i, "") ?? "State / province";

  return (
    <fieldset className="space-y-4 rounded-md border border-foreground/15 p-4">
      <legend className="px-1 text-lg font-semibold">{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" autoComplete={prefix === "sender" ? "name" : "off"} value={value.name} onChange={set("name")} error={error("name")} required />
        <TextField label="Company (optional)" value={value.company} onChange={set("company")} error={error("company")} />
        <TextField label="Phone" type="tel" autoComplete={prefix === "sender" ? "tel" : "off"} value={value.phone} onChange={set("phone")} error={error("phone")} hint="Include the country code, for example +234 801 000 0000." required />
        <TextField label={prefix === "sender" ? "Email (optional)" : "Email (optional, for delivery updates)"} type="email" value={value.email} onChange={set("email")} error={error("email")} />
      </div>
      <TextField label="Address" autoComplete={prefix === "sender" ? "address-line1" : "off"} value={value.line1} onChange={set("line1")} error={error("line1")} required />
      <TextField label="Address line 2 (optional)" value={value.line2} onChange={set("line2")} error={error("line2")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="City" value={value.city} onChange={set("city")} error={error("city")} required />
        <TextField label={country?.state_required ? stateLabel : `${stateLabel} (optional)`} value={value.state} onChange={set("state")} error={error("state")} required={country?.state_required} />
        <TextField label={country?.postal_code_required ? "Postal code" : "Postal code (optional)"} value={value.postal_code} onChange={set("postal_code")} error={error("postal_code")} required={country?.postal_code_required} />
      </div>
      <SelectField label="Country" value={value.country} onChange={() => {}} disabled hint="Set by your quote. To change it, start a new quote.">
        {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </SelectField>
    </fieldset>
  );
}
