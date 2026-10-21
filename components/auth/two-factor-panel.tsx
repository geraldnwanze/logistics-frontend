"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { beginTwoFactorSetup, confirmTwoFactor, disableTwoFactor, fetchTwoFactorStatus, regenerateRecoveryCodes } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { CURRENT_USER_KEY } from "@/lib/auth/session";

const STATUS_KEY = ["two-factor"] as const;

type Mode =
  | { kind: "idle" }
  | { kind: "setup"; secret: string; uri: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "regenerate" }
  | { kind: "disable" };

/** "JBSW Y3DP ..." — easier to type from a screen. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function TwoFactorPanel() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: fetchTwoFactorStatus, retry: false });
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: STATUS_KEY }), client.invalidateQueries({ queryKey: CURRENT_USER_KEY })]);

  function reset(next: Mode) {
    setMode(next);
    setError(null);
    setCode("");
    setPassword("");
    setUseRecovery(false);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);

    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "invalid_password" ? "That password isn't correct." : caught instanceof ApiError && caught.code === "invalid_two_factor_code" ? "That code isn't correct." : describeError(caught));
    } finally {
      setPending(false);
    }
  }

  const start = () => run(async () => {
    const { secret, uri } = await beginTwoFactorSetup();
    reset({ kind: "setup", secret, uri });
    await client.invalidateQueries({ queryKey: STATUS_KEY });
  });

  const confirm = (event: FormEvent) => {
    event.preventDefault();

    return run(async () => {
      const codes = await confirmTwoFactor(code.replace(/\s+/g, ""));
      reset({ kind: "codes", codes });
      await refresh();
    });
  };

  const regenerate = (event: FormEvent) => {
    event.preventDefault();

    return run(async () => {
      const codes = await regenerateRecoveryCodes(password);
      reset({ kind: "codes", codes });
      await refresh();
    });
  };

  const disable = (event: FormEvent) => {
    event.preventDefault();

    return run(async () => {
      await disableTwoFactor({ password, ...(useRecovery ? { recovery_code: code.trim() } : { code: code.replace(/\s+/g, "") }) });
      reset({ kind: "idle" });
      await refresh();
    });
  };

  if (status.isPending) return <p role="status">Loading security settings…</p>;
  if (status.isError || !status.data) return <p role="alert">We couldn&apos;t load your security settings. Please reload the page.</p>;

  const { enabled, required, recovery_codes_remaining: remaining } = status.data;

  return (
    <section aria-labelledby="two-factor-heading" className="rounded-md border border-foreground/15 p-5">
      <h2 id="two-factor-heading" className="text-xl font-semibold">Two-factor authentication</h2>
      <p className="mt-1 text-sm opacity-80">
        Status: <strong>{enabled ? "On" : "Off"}</strong>. A code from an authenticator app is asked for when you sign in, so a stolen password alone is not enough.
      </p>
      {required && !enabled ? (
        <p role="note" className="mt-3 rounded-md border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">Your role requires two-factor authentication. Turn it on to use the back office.</p>
      ) : null}
      <div className="mt-4 space-y-4">
        <FormAlert message={error} />

        {mode.kind === "idle" && !enabled ? <Button onClick={start} disabled={pending}>{pending ? "Starting…" : "Turn on"}</Button> : null}

        {mode.kind === "setup" ? (
          <form onSubmit={confirm} className="space-y-4" noValidate>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Open an authenticator app (for example Google Authenticator, Microsoft Authenticator, 1Password or Authy).</li>
              <li>
                Add an account using this key:
                <code className="mt-1 block break-all rounded bg-foreground/5 p-2 font-mono text-base" data-testid="setup-key">{groupSecret(mode.secret)}</code>
                {mode.uri.startsWith("otpauth://") ? <a href={mode.uri} className="mt-1 inline-block underline">Open in an authenticator app on this device</a> : null}
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <TextField label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || code.trim() === ""}>{pending ? "Checking…" : "Confirm and turn on"}</Button>
              <Button type="button" variant="ghost" onClick={() => reset({ kind: "idle" })}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {mode.kind === "codes" ? <RecoveryCodes codes={mode.codes} onDone={() => reset({ kind: "idle" })} /> : null}

        {mode.kind === "idle" && enabled ? (
          <div>
            <p className="text-sm">Recovery codes left: <strong>{remaining ?? 0}</strong>{remaining !== null && remaining <= 2 ? " — generate new ones soon." : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => reset({ kind: "regenerate" })}>New recovery codes</Button>
              <Button variant="outline" onClick={() => reset({ kind: "disable" })}>Turn off</Button>
            </div>
          </div>
        ) : null}

        {mode.kind === "regenerate" ? (
          <form onSubmit={regenerate} className="space-y-4" noValidate>
            <p className="text-sm">Your current recovery codes will stop working.</p>
            <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || password === ""}>Create new codes</Button>
              <Button type="button" variant="ghost" onClick={() => reset({ kind: "idle" })}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {mode.kind === "disable" ? (
          <form onSubmit={disable} className="space-y-4" noValidate>
            <p className="text-sm">{required ? "Your role requires two-factor authentication, so you will need to turn it on again before using the back office. " : ""}Confirm with your password and a code.</p>
            <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <TextField label={useRecovery ? "Recovery code" : "6-digit code"} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
            <button type="button" className="text-sm underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Use my authenticator app" : "Use a recovery code"}</button>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={pending || password === "" || code.trim() === ""}>Turn off two-factor</Button>
              <Button type="button" variant="ghost" onClick={() => reset({ kind: "idle" })}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied.");
    } catch {
      setNote("Couldn't copy. Select the codes and copy them by hand.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`Recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <p role="status" className="text-sm"><strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They won&apos;t be shown again.</p>
      <ul className="grid grid-cols-2 gap-2 rounded bg-foreground/5 p-3 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>Copy</Button>
        <Button variant="outline" size="sm" onClick={download}>Download</Button>
        {note ? <span role="status" className="text-sm">{note}</span> : null}
      </div>
      <Button onClick={onDone}>I&apos;ve saved my codes</Button>
    </div>
  );
}
