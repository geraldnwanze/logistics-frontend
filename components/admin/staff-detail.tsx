"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";
import { changeRoles, ERROR_TEXT, fetchRoles, fetchStaffMember, reactivateStaff, resetStaffTwoFactor, roleChanges, roleLabel, sendStaffPasswordReset, suspendStaff, SUPER_ADMIN, type StaffDetail } from "@/lib/admin/staff";
import { formatDate } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";

type Action = "suspend" | "reactivate" | "password" | "twofactor";

function RolesEditor({ member, onSaved, setError }: { member: StaffDetail; onSaved: (message: string) => Promise<void>; setError: (message: string | null) => void }) {
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: ({ signal }) => fetchRoles(signal), staleTime: 300_000, retry: false });
  const [chosen, setChosen] = useState<string[]>(member.roles);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const changes = roleChanges(member.roles, chosen);
  const changed = changes.added.length + changes.removed.length > 0;

  async function save() {
    setPending(true);
    setError(null);

    try {
      await changeRoles(member.id, chosen);
      await onSaved(`${member.name}'s roles were saved.`);
    } catch (caught) {
      setError(caught instanceof ApiError && ERROR_TEXT[caught.code] ? ERROR_TEXT[caught.code] : describeError(caught));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby="roles-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="roles-heading" className="text-lg font-semibold">Roles</h2>
      <p className="mt-1 text-sm">A role decides which parts of the back office someone can use. Changes take effect on their next request.</p>
      {roles.isPending ? <p role="status" className="mt-2 text-sm">Loading roles…</p> : null}
      {roles.isError ? <AdminProblem error={roles.error} what="the roles" onRetry={() => void roles.refetch()} /> : null}
      <fieldset disabled={confirming || pending} className="mt-3 space-y-1">
        <legend className="sr-only">Roles</legend>
        {(roles.data ?? []).map((r) => (
          <div key={r.name} className="rounded-md border border-foreground/10 px-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-5" checked={chosen.includes(r.name)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, r.name] : c.filter((x) => x !== r.name)))} />
              {roleLabel(r.name)}{r.grants_everything ? " (full access)" : ""}
            </label>
            <details className="pb-2 text-sm">
              <summary className="min-h-8 cursor-pointer underline">What this allows<span className="sr-only"> for {roleLabel(r.name)}</span></summary>
              {r.grants_everything ? <p className="mt-1">Everything, including managing other administrators.</p> : <p className="mt-1 break-words opacity-80">{r.permissions.length === 0 ? "No back-office permissions." : r.permissions.map((p) => p.replace(/\./g, " ")).join(", ")}</p>}
            </details>
          </div>
        ))}
      </fieldset>
      {confirming ? (
        <div role="group" aria-label="Confirm role changes" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
          <span>
            {changes.added.length > 0 ? `Give ${member.name}: ${changes.added.map(roleLabel).join(", ")}. ` : ""}
            {changes.removed.length > 0 ? `Take away: ${changes.removed.map(roleLabel).join(", ")}. ` : ""}
            This takes effect straight away.
          </span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={save}>{pending ? "Saving…" : "Yes, save the roles"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!changed || chosen.length === 0} onClick={() => setConfirming(true)}>Review role changes</Button>
          {chosen.length === 0 ? <span className="text-sm text-red-800">Choose at least one role.</span> : null}
        </div>
      )}
    </section>
  );
}

export function StaffDetailView({ id, user }: { id: string; user: User }) {
  const client = useQueryClient();
  const member = useQuery({ queryKey: ["admin-staff-member", id], queryFn: ({ signal }) => fetchStaffMember(id, signal), retry: false });
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (member.isPending) return <p role="status">Loading…</p>;
  if (member.isError) return <AdminProblem error={member.error} what="this person" onRetry={() => void member.refetch()} />;

  const m = member.data;
  const self = m.id === user.id;
  const actorIsSuper = user.roles.includes(SUPER_ADMIN);
  const lockedForActor = m.roles.includes(SUPER_ADMIN) && !actorIsSuper;
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin-staff-member", id] }), client.invalidateQueries({ queryKey: ["admin-staff"] })]); };

  async function run(task: () => Promise<unknown>, done: string) {
    setPending(true);
    setError(null);
    setSaved(null);

    try {
      await task();
      await refresh();
      setSaved(done);
    } catch (caught) {
      setError(caught instanceof ApiError && ERROR_TEXT[caught.code] ? ERROR_TEXT[caught.code] : describeError(caught));
    } finally {
      setPending(false);
      setAction(null);
    }
  }

  const confirmations: Record<Action, { text: string; yes: string; task: () => Promise<unknown>; done: string }> = {
    suspend: { text: `Suspend ${m.name}? They're signed out right away and can't sign in again until you reactivate them.`, yes: "Yes, suspend", task: () => suspendStaff(m.id), done: `${m.name} was suspended.` },
    reactivate: { text: `Let ${m.name} sign in again?`, yes: "Yes, reactivate", task: () => reactivateStaff(m.id), done: `${m.name} can sign in again.` },
    password: { text: `Email ${m.email} a link to choose a new password?`, yes: "Yes, send the link", task: () => sendStaffPasswordReset(m.id), done: `A password reset link was sent to ${m.email}.` },
    twofactor: { text: `Remove ${m.name}'s authenticator? They must set up two-factor again before they can use the back office. Only do this once you're sure it's really them asking.`, yes: "Yes, reset two-factor", task: () => resetStaffTwoFactor(m.id), done: `${m.name}'s two-factor was reset.` },
  };
  const buttons: { key: Action; label: string; show: boolean; allowSelf?: boolean }[] = [
    { key: "suspend", label: "Suspend", show: m.status === "active" },
    { key: "reactivate", label: "Reactivate", show: m.status === "suspended" },
    { key: "password", label: "Send password reset link", show: true, allowSelf: true },
    { key: "twofactor", label: "Reset two-factor", show: m.two_factor_enabled },
  ];

  return (
    <div className="space-y-6">
      <p><Link href="/admin/staff" className="text-sm underline">← All staff</Link></p>
      <header>
        <h1 className="text-2xl font-semibold">{m.name}{self ? " (you)" : ""}</h1>
        <p className="break-all text-sm">{m.email}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {m.status === "suspended" ? <StatusChip label="Suspended" tone="bad" /> : <StatusChip label="Active" tone="good" />}
          {m.two_factor_enabled ? <StatusChip label="Two-factor on" tone="good" /> : <StatusChip label="No two-factor yet" tone="warn" />}
          <span className="opacity-75">Added {formatDate(m.created_at)}{m.suspended_at ? ` · suspended ${formatDate(m.suspended_at)}` : ""}</span>
        </p>
      </header>

      <FormAlert message={error} />
      {saved ? <p role="status" className="rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}
      {self ? <p role="note" className="rounded-md border border-foreground/20 p-3 text-sm">This is your own account. You can ask for a password reset link, but changes to your access have to be made by another administrator.</p> : null}
      {lockedForActor ? <p role="note" className="rounded-md border border-foreground/20 p-3 text-sm">Only a super administrator can change a super administrator&apos;s account.</p> : null}

      {!self && !lockedForActor ? <RolesEditor key={m.roles.join("|")} member={m} setError={setError} onSaved={async (message) => { await refresh(); setSaved(message); }} /> : (
        <section aria-labelledby="roles-heading"><h2 id="roles-heading" className="text-lg font-semibold">Roles</h2><p className="mt-1 text-sm">{m.roles.map(roleLabel).join(", ")}</p></section>
      )}

      <section aria-labelledby="perm-heading">
        <h2 id="perm-heading" className="text-lg font-semibold">What they can do</h2>
        <details className="mt-1 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 underline">{m.permissions.length} permissions from their roles</summary>
          <p className="break-words opacity-80">{m.permissions.map((p) => p.replace(/\./g, " ")).join(", ") || "None."}</p>
        </details>
      </section>

      {!lockedForActor ? (
        <section aria-labelledby="account-heading" className="rounded-md border border-foreground/20 p-4">
          <h2 id="account-heading" className="text-lg font-semibold">Account</h2>
          {action ? (
            <div role="group" aria-label="Confirm" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-foreground/5 p-3 text-sm">
              <span>{confirmations[action].text}</span>
              <Button type="button" className="min-h-11" disabled={pending} onClick={() => void run(confirmations[action].task, confirmations[action].done)}>{pending ? "Working…" : confirmations[action].yes}</Button>
              <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setAction(null)}>Cancel</Button>
            </div>
          ) : (
            <p className="mt-3 flex flex-wrap gap-2">
              {buttons.filter((b) => b.show && (b.allowSelf || !self)).map((b) => <Button key={b.key} type="button" variant="outline" className="min-h-11" onClick={() => { setSaved(null); setAction(b.key); }}>{b.label}</Button>)}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
