"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { completeTwoFactor, login } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { safeNextPath, useSessionActions } from "@/lib/auth/session";

type Step = "password" | "code";

export function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const { signedIn } = useSessionActions();
  const [step, setStep] = useState<Step>("password");
  const [useRecovery, setUseRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step, useRecovery]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const outcome = await login(email.trim(), password);

      if (outcome.kind === "two-factor") {
        setPassword("");
        setStep("code");
      } else {
        // Next keeps the previous page mounted (hidden) after navigating, so don't leave the password in it.
        setPassword("");
        signedIn(outcome.user);
        router.push(next);
      }
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "invalid_credentials" ? "That email and password don't match. Check them and try again." : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const user = await completeTwoFactor(useRecovery ? { recovery_code: code.trim() } : { code: code.replace(/\s+/g, "") });
      setCode("");
      signedIn(user);
      router.push(next);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === "two_factor_expired" || caught.code === "two_factor_locked")) {
        // The password step is no longer valid on the server, so start again from the beginning.
        setStep("password");
        setCode("");
        setError(caught.code === "two_factor_locked" ? "Too many incorrect codes. Please sign in again." : "Your sign-in timed out. Please sign in again.");
      } else if (caught instanceof ApiError && caught.code === "invalid_two_factor_code") {
        setError(useRecovery ? "That recovery code isn't valid or has already been used." : "That code isn't correct. Check your authenticator app and try again.");
        setCode("");
      } else {
        setError(describeError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={submitCode} className="space-y-4" noValidate>
        <p>{useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}</p>
        <FormAlert message={error} />
        <TextField
          ref={codeRef} label={useRecovery ? "Recovery code" : "Authentication code"} value={code} onChange={(e) => setCode(e.target.value)}
          inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required
          {...(useRecovery ? {} : { pattern: "[0-9 ]*", maxLength: 7 })} data-testid="code-input"
        />
        <Button type="submit" disabled={pending || code.trim() === ""} className="w-full">{pending ? "Checking…" : "Verify"}</Button>
        <div className="flex justify-between text-sm">
          <button type="button" className="underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(null); }}>
            {useRecovery ? "Use my authenticator app" : "Use a recovery code"}
          </button>
          <button type="button" className="underline" onClick={() => { setStep("password"); setCode(""); setError(null); }}>Start over</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="space-y-4" noValidate>
      <FormAlert message={error} />
      <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button type="submit" disabled={pending || email.trim() === "" || password === ""} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="text-sm"><Link href="/forgot-password" className="underline">Forgot your password?</Link></p>
    </form>
  );
}
