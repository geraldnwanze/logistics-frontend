"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { fetchProfileOptions, updateProfile, type ProfilePatch } from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { Profile, User } from "@/lib/auth/schemas";
import { CURRENT_USER_KEY } from "@/lib/auth/session";

type Values = { name: string; phone: string; locale: string; timezone: string; preferred_currency: string };
type FieldName = keyof Values;

const DEFAULT_PROFILE: Profile = { phone: null, locale: "en", timezone: "UTC", preferred_currency: "USD" };

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Browsers disagree about "UTC" (Chromium leaves it out of the list, yet it is every new account's default), and
 * the saved value must stay selectable even after the person picks something else, so both are always included.
 */
function timeZones(...keep: string[]): string[] {
  let zones: string[] = [];

  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    /* older browsers: only the values below are offered */
  }

  return [...new Set(["UTC", ...keep, ...zones])];
}

function toValues(user: User): Values {
  const profile = user.profile ?? DEFAULT_PROFILE;

  return { name: user.name, phone: profile.phone ?? "", locale: profile.locale, timezone: profile.timezone, preferred_currency: profile.preferred_currency };
}

/** Only what changed: the API treats every field it receives as an update. */
export function changedFields(initial: Values, current: Values): ProfilePatch {
  const patch: ProfilePatch = {};

  if (current.name.trim() !== initial.name) patch.name = current.name.trim();
  if (current.phone.trim() !== initial.phone) patch.phone = current.phone.trim() === "" ? null : current.phone.trim();
  if (current.locale !== initial.locale) patch.locale = current.locale;
  if (current.timezone !== initial.timezone) patch.timezone = current.timezone;
  if (current.preferred_currency !== initial.preferred_currency) patch.preferred_currency = current.preferred_currency;

  return patch;
}

export function ProfileForm({ user }: { user: User }) {
  const client = useQueryClient();
  const options = useQuery({ queryKey: ["profile-options"], queryFn: fetchProfileOptions, staleTime: 5 * 60_000, retry: false });
  const [initial, setInitial] = useState<Values>(() => toValues(user));
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // The saved choice always stays in each list, even if the business later switched it off or the person picks another.
  const languages = useMemo(() => [...new Set([...(options.data?.languages ?? []), initial.locale, values.locale])], [options.data, initial.locale, values.locale]);
  const currencies = useMemo(() => {
    const list = options.data?.currencies ?? [];
    const missing = [initial.preferred_currency, values.preferred_currency].filter((code, i, all) => all.indexOf(code) === i && !list.some((c) => c.code === code));

    return [...missing.map((code) => ({ code, name: "", symbol: "" })), ...list];
  }, [options.data, initial.preferred_currency, values.preferred_currency]);
  const zones = useMemo(() => timeZones(initial.timezone, values.timezone), [initial.timezone, values.timezone]);
  const patch = changedFields(initial, values);
  const dirty = Object.keys(patch).length > 0;

  const set = (field: FieldName) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setSaved(false);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    if (values.name.trim() === "") {
      setErrors({ name: "Enter your name." });

      return;
    }

    setErrors({});
    setPending(true);

    try {
      const updated = await updateProfile(patch);
      client.setQueryData(CURRENT_USER_KEY, updated);
      const next = toValues(updated);
      setInitial(next);
      setValues(next);
      setSaved(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors({
          name: caught.field("name"), phone: caught.field("phone"), locale: caught.field("locale"),
          timezone: caught.field("timezone"), preferred_currency: caught.field("preferred_currency"),
        });
      } else {
        setFormError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormAlert message={formError} />
      {saved ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">Your changes have been saved.</p> : null}

      <TextField label="Full name" autoComplete="name" value={values.name} onChange={set("name")} error={errors.name} required />
      <div>
        <TextField label="Email" type="email" value={user.email} readOnly aria-readonly hint="To change your email address, contact support." className="bg-foreground/5" />
      </div>
      <TextField label="Phone" type="tel" autoComplete="tel" value={values.phone} onChange={set("phone")} error={errors.phone} hint="Used for delivery contact and, if you opt in, text messages." />

      <SelectField label="Language" value={values.locale} onChange={set("locale")} error={errors.locale} hint="The language of emails and notifications we send you, where we have it.">
        {languages.map((code) => <option key={code} value={code}>{languageName(code)} ({code})</option>)}
      </SelectField>

      <SelectField label="Currency" value={values.preferred_currency} onChange={set("preferred_currency")} error={errors.preferred_currency} hint="Used to show prices. Charges are made in the currency shown at checkout.">
        {currencies.map((c) => <option key={c.code} value={c.code}>{c.name ? `${c.code} — ${c.name}` : c.code}</option>)}
      </SelectField>

      <div>
        <SelectField label="Time zone" value={values.timezone} onChange={set("timezone")} error={errors.timezone} hint="Tracking times are shown in the place they happened; this is used for your own dates.">
          {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
        </SelectField>
        <button
          type="button" className="mt-1 text-sm underline"
          onClick={() => { setValues((current) => ({ ...current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })); setSaved(false); }}
        >
          Use this device&apos;s time zone
        </button>
      </div>

      {options.isError ? <p role="note" className="text-sm opacity-75">We couldn&apos;t load the full list of languages and currencies, so only your current choices are shown.</p> : null}

      <Button type="submit" disabled={pending || !dirty}>{pending ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}
