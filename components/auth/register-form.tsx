"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { register } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { useSessionActions } from "@/lib/auth/session";

type Fields = "name" | "email" | "phone" | "password" | "password_confirmation";

export const MIN_PASSWORD_LENGTH = 12;

/** The same checks the API makes, so most mistakes are caught before sending (the API stays the authority). */
export function validateRegistration(values: Record<Fields, string>): Partial<Record<Fields, string>> {
  const errors: Partial<Record<Fields, string>> = {};

  if (values.name.trim() === "") errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
  if (values.password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (!/[a-z]/.test(values.password) || !/[A-Z]/.test(values.password) || !/\d/.test(values.password)) errors.password = "Include upper and lower case letters and a number.";
  if (values.password_confirmation !== values.password) errors.password_confirmation = "The passwords don't match.";

  return errors;
}

export function RegisterForm() {
  const router = useRouter();
  const { signedIn } = useSessionActions();
  const [values, setValues] = useState<Record<Fields, string>>({ name: "", email: "", phone: "", password: "", password_confirmation: "" });
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (field: Fields) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problems = validateRegistration(values);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setPending(true);

    try {
      const user = await register({ ...values, name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim() });
      setValues((current) => ({ ...current, password: "", password_confirmation: "" }));   // the page stays mounted, hidden, after navigating
      signedIn(user);
      router.push("/account");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setErrors({
          name: caught.field("name"), email: caught.field("email"), phone: caught.field("phone"),
          password: caught.field("password"), password_confirmation: caught.field("password_confirmation"),
        });
        if (Object.keys(caught.fieldErrors).length === 0) setFormError(describeError(caught));
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
      <TextField label="Full name" autoComplete="name" value={values.name} onChange={set("name")} error={errors.name} required />
      <TextField label="Email" type="email" autoComplete="email" value={values.email} onChange={set("email")} error={errors.email} required />
      <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={values.phone} onChange={set("phone")} error={errors.phone} />
      <TextField
        label="Password" type="password" autoComplete="new-password" value={values.password} onChange={set("password")} error={errors.password} required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters with upper and lower case letters and a number. Passwords found in known data breaches are refused.`}
      />
      <TextField label="Confirm password" type="password" autoComplete="new-password" value={values.password_confirmation} onChange={set("password_confirmation")} error={errors.password_confirmation} required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
