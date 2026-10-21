"use client";

import { useState, type FormEvent } from "react";
import { MIN_PASSWORD_LENGTH, validateRegistration } from "@/components/auth/register-form";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { changePassword } from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";

type Fields = "current_password" | "password" | "password_confirmation";

export function PasswordForm() {
  const [values, setValues] = useState<Record<Fields, string>>({ current_password: "", password: "", password_confirmation: "" });
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (field: Fields) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setDone(false);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setDone(false);

    const checks = validateRegistration({ name: "x", email: "x@x.xx", phone: "", password: values.password, password_confirmation: values.password_confirmation });
    const problems: Partial<Record<Fields, string>> = { password: checks.password, password_confirmation: checks.password_confirmation };
    if (values.current_password === "") problems.current_password = "Enter your current password.";
    else if (values.password === values.current_password) problems.password = "Choose a password different from your current one.";
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;

    setPending(true);

    try {
      await changePassword(values);
      setValues({ current_password: "", password: "", password_confirmation: "" });
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422 && Object.keys(caught.fieldErrors).length > 0) {
        setErrors({ current_password: caught.field("current_password"), password: caught.field("password"), password_confirmation: caught.field("password_confirmation") });
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
      {done ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">Your password has been changed. You&apos;ve been signed out of other devices.</p> : null}
      <TextField label="Current password" type="password" autoComplete="current-password" value={values.current_password} onChange={set("current_password")} error={errors.current_password} required />
      <TextField
        label="New password" type="password" autoComplete="new-password" value={values.password} onChange={set("password")} error={errors.password} required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters with upper and lower case letters and a number. Passwords found in known data breaches are refused.`}
      />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={values.password_confirmation} onChange={set("password_confirmation")} error={errors.password_confirmation} required />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
