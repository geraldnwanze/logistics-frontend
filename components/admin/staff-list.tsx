"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parsePage } from "@/components/account/shipments-list";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextField } from "@/components/ui/field";
import { Pager, StatusChip } from "@/components/ui/pager";
import { STAFF_STATUS_LABELS } from "@/lib/admin/labels";
import { ERROR_TEXT, fetchRoles, fetchStaff, inviteStaff, roleLabel, SUPER_ADMIN, type StaffFilters } from "@/lib/admin/staff";
import { ApiError } from "@/lib/api/client";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";
import { formatDate } from "@/lib/shipping/format";
import { AdminProblem } from "./admin-shell";

export function staffFiltersFrom(params: URLSearchParams): StaffFilters {
  const status = params.get("status") ?? "";
  const role = params.get("role") ?? "";

  return { status: status in STAFF_STATUS_LABELS ? status : undefined, role: /^[a-z-]{3,40}$/.test(role) ? role : undefined, q: params.get("q")?.trim().slice(0, 120) || undefined, page: parsePage(params.get("page")) };
}

export function staffHref(filters: StaffFilters, page = 1): string {
  const search = new URLSearchParams();
  const entries: [string, string | undefined][] = [["status", filters.status], ["role", filters.role], ["q", filters.q], ["page", page > 1 ? String(page) : undefined]];
  for (const [key, value] of entries) if (value) search.set(key, value);
  const text = search.toString();

  return `/admin/staff${text ? `?${text}` : ""}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInvite(v: { name: string; email: string; roles: string[] }): Partial<Record<"name" | "email" | "roles", string>> {
  const errors: Partial<Record<"name" | "email" | "roles", string>> = {};
  if (v.name.trim() === "") errors.name = "Enter their name.";
  if (!EMAIL.test(v.email.trim())) errors.email = "Enter a full email address, for example sam@example.com.";
  if (v.roles.length === 0) errors.roles = "Choose at least one role.";
  else if (v.roles.length > 6) errors.roles = "Choose at most six roles.";

  return errors;
}

/** Adding a colleague: they get an email with a link to choose their own password, and pick up a second factor when they first sign in. */
function InviteForm({ actor, onDone, onCancel }: { actor: User; onDone: (message: string) => Promise<void>; onCancel: () => void }) {
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: ({ signal }) => fetchRoles(signal), staleTime: 300_000, retry: false });
  const [v, setV] = useState({ name: "", email: "", roles: [] as string[] });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "roles", string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuper = actor.roles.includes(SUPER_ADMIN);

  function review(event: FormEvent) {
    event.preventDefault();
    const found = validateInvite(v);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  }

  async function send() {
    setPending(true);
    setError(null);

    try {
      await inviteStaff({ name: v.name.trim(), email: v.email.trim().toLowerCase(), roles: v.roles });
      await onDone(`An invitation was sent to ${v.email.trim().toLowerCase()}.`);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) setErrors({ name: caught.field("name"), email: caught.field("email"), roles: caught.field("roles") ?? caught.field("roles.0") });
      setError(caught instanceof ApiError && ERROR_TEXT[caught.code] ? ERROR_TEXT[caught.code] : describeError(caught));
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={review} noValidate aria-label="Invite a colleague" className="space-y-3 rounded-md border border-foreground/20 bg-foreground/5 p-4">
      <h2 className="text-lg font-semibold">Invite a colleague</h2>
      <FormAlert message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} error={errors.name} maxLength={255} disabled={confirming} autoComplete="off" />
        <TextField label="Email" type="email" value={v.email} onChange={(e) => setV((c) => ({ ...c, email: e.target.value }))} error={errors.email} maxLength={255} disabled={confirming} autoComplete="off" />
      </div>
      <fieldset disabled={confirming}>
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        {roles.isPending ? <p className="text-sm">Loading roles…</p> : null}
        {roles.isError ? <AdminProblem error={roles.error} what="the roles" onRetry={() => void roles.refetch()} /> : null}
        <div className="grid gap-x-4 sm:grid-cols-2">
          {(roles.data ?? []).map((r) => (
            <label key={r.name} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={v.roles.includes(r.name)} disabled={r.name === SUPER_ADMIN && !isSuper} onChange={(e) => setV((c) => ({ ...c, roles: e.target.checked ? [...c.roles, r.name] : c.roles.filter((x) => x !== r.name) }))} />
              <span>{roleLabel(r.name)}{r.grants_everything ? " (full access)" : ""}</span>
            </label>
          ))}
        </div>
        {errors.roles ? <p className="mt-1 text-sm text-red-700">{errors.roles}</p> : null}
      </fieldset>
      {confirming ? (
        <div role="group" aria-label="Confirm invitation" className="flex flex-wrap items-center gap-2 rounded-md bg-background p-3 text-sm">
          <span>Invite {v.name.trim()} ({v.email.trim().toLowerCase()}) as {v.roles.map(roleLabel).join(", ")}? They&apos;ll get an email with a link to choose a password.</span>
          <Button type="button" className="min-h-11" disabled={pending} onClick={send}>{pending ? "Sending…" : "Yes, send the invitation"}</Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>Go back</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Review invitation</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      )}
    </form>
  );
}

export function StaffList({ user }: { user: User }) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const filters = staffFiltersFrom(new URLSearchParams(useSearchParams().toString()));
  const [search, setSearch] = useState(filters.q ?? "");
  const [inviting, setInviting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin-staff", filters], queryFn: ({ signal }) => fetchStaff(filters, signal), placeholderData: keepPreviousData, retry: false });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: ({ signal }) => fetchRoles(signal), staleTime: 300_000, retry: false });
  const go = (change: Partial<StaffFilters>) => router.replace(staffHref({ ...filters, ...change, page: undefined }));
  const anyFilter = Boolean(filters.status || filters.role || filters.q);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Staff</h1>
      <p className="mt-2 text-sm opacity-80">Everyone who can sign in to the back office, and what they can do. Customers never appear here.</p>
      {saved ? <p role="status" className="mt-4 rounded-md border border-green-700/40 bg-green-50 p-3 text-sm text-green-900">{saved}</p> : null}
      <div className="mt-4">
        {inviting ? <InviteForm actor={user} onCancel={() => setInviting(false)} onDone={async (message) => { setInviting(false); setSaved(message); await client.invalidateQueries({ queryKey: ["admin-staff"] }); }} /> : <Button type="button" onClick={() => { setSaved(null); setInviting(true); }}>Invite a colleague</Button>}
      </div>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go({ q: search.trim() || undefined }); }} role="search" aria-label="Filter staff" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Status" value={filters.status ?? ""} onChange={(e) => go({ status: e.target.value || undefined })}>
          <option value="">Anyone</option>
          {Object.entries(STAFF_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="Role" value={filters.role ?? ""} onChange={(e) => go({ role: e.target.value || undefined })}>
          <option value="">Any role</option>
          {(roles.data ?? []).map((r) => <option key={r.name} value={r.name}>{roleLabel(r.name)}</option>)}
        </SelectField>
        <TextField label="Name or email" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={120} />
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline" className="min-h-11">Search</Button>
          {anyFilter ? <Link href={pathname} className="inline-flex min-h-11 items-center px-2 text-sm underline">Clear filters</Link> : null}
        </div>
      </form>

      <div className="mt-6">
        {list.isPending ? <p role="status">Loading staff…</p> : null}
        {list.isError ? <AdminProblem error={list.error} what="the staff list" onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 ? <p role="status" className="rounded-md border border-foreground/20 p-6 text-center">{anyFilter ? "No staff match these filters." : "There are no staff accounts yet."}</p> : null}
        {list.data && list.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-sm opacity-75" aria-live="polite">{list.data.total} {list.data.total === 1 ? "person" : "people"}</p>
            <ul className="space-y-3" aria-busy={list.isFetching} aria-label="Staff">
              {list.data.items.map((s) => (
                <li key={s.id} className="rounded-md border border-foreground/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/staff/${encodeURIComponent(s.id)}`} className="text-lg font-semibold underline">{s.name}{s.id === user.id ? " (you)" : ""}</Link>
                      <p className="break-all text-sm opacity-80">{s.email} · added {formatDate(s.created_at)}</p>
                      <p className="mt-1 text-sm">{s.roles.map(roleLabel).join(", ")}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.status === "suspended" ? <StatusChip label="Suspended" tone="bad" /> : <StatusChip label="Active" tone="good" />}
                      {s.two_factor_enabled ? null : <StatusChip label="No two-factor yet" tone="warn" />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={list.data.page} lastPage={list.data.lastPage} hrefFor={(page) => staffHref(filters, page)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
