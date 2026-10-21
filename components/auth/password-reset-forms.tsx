"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { requestPasswordReset, resetPassword } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { validateRegistration } from "./register-form";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    // The API answers the same way whether or not the account exists, and so do we.
    return <p role="status" className="rounded-md border border-foreground/20 p-4">If an account exists for {email.trim()}, we&apos;ve sent a link to choose a new password. It expires after an hour.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert message={error} />
      <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Button type="submit" disabled={pending || email.trim() === ""} className="w-full">{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  // The token is read once and removed from the address bar so it doesn't linger in history or get shared by accident.
  const [credentials] = useState(() => ({ token: params.get("token") ?? "", email: params.get("email") ?? "" }));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<{ password?: string; password_confirmation?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (credentials.token) window.history.replaceState(null, "", window.location.pathname);
  }, [credentials.token]);

  if (!credentials.token || !credentials.email) {
    return (
      <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 p-4 text-red-900">
        This reset link is incomplete. <Link href="/forgot-password" className="underline">Request a new one</Link>.
      </p>
    );
  }

  if (done) {
    return <p role="status" className="rounded-md border border-foreground/20 p-4">Your password has been changed. <Link href="/login" className="underline">Sign in</Link> with the new password.</p>;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const checks = validateRegistration({ name: "x", email: "x@x.xx", phone: "", password, password_confirmation: confirmation });
    const problems = { password: checks.password, password_confirmation: checks.password_confirmation };
    setErrors(problems);
    if (problems.password || problems.password_confirmation) return;

    setPending(true);

    try {
      await resetPassword({ ...credentials, password, password_confirmation: confirmation });
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "invalid_reset_token") {
        setFormError("This reset link is invalid or has expired. Request a new one below.");
      } else if (caught instanceof ApiError && caught.status === 422 && caught.field("password")) {
        setErrors({ password: caught.field("password") });
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
      {formError?.includes("expired") ? <p className="text-sm"><Link href="/forgot-password" className="underline">Request a new link</Link></p> : null}
      <p className="text-sm opacity-80">Choosing a new password for <strong>{credentials.email}</strong>.</p>
      <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required hint="At least 12 characters with upper and lower case letters and a number." />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} error={errors.password_confirmation} required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
