"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/pager";
import { downloadLedger, fetchReconciliation, formatMinorAmount, type Reconciliation } from "@/lib/admin/finance";
import { can, RECONCILIATION_TITLES } from "@/lib/admin/labels";
import type { User } from "@/lib/auth/schemas";
import { describeError } from "@/lib/auth/errors";
import { AdminProblem } from "./admin-shell";
import { FinanceTabs } from "./finance-tabs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** One cell of a check's rows: money in minor units gets its currency, timestamps are made readable, the rest is shown as it is. */
export function formatCell(key: string, value: unknown, row: Record<string, unknown>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key.endsWith("_minor") && typeof value === "number") return typeof row.currency_code === "string" ? formatMinorAmount(value, row.currency_code) : String(value);
  if (typeof value === "string" && TIMESTAMP.test(value)) {
    // PostgreSQL writes "2026-10-08 03:17:31+00": make it ISO ("T", and "+00:00"), and show the text as it came if it still isn't a date.
    const date = new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));

    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  return String(value);
}

const heading = (key: string) => key.replace(/_minor$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Check({ name, check }: { name: string; check: Reconciliation["checks"][string] }) {
  const columns = check.rows.length > 0 ? Object.keys(check.rows[0]).filter((k) => k !== "currency_code") : [];
  const clear = check.count === 0;

  return (
    <li className="rounded-md border border-foreground/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{RECONCILIATION_TITLES[name] ?? name.replace(/_/g, " ")}</h3>
          <p className="text-sm opacity-80">{check.description}</p>
        </div>
        <StatusChip label={clear ? "All clear" : `${check.count} to look at`} tone={clear ? "good" : "bad"} />
      </div>
      {clear ? null : (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium underline">Show the {check.rows.length === check.count ? "" : "first "}{check.rows.length} {check.rows.length === 1 ? "row" : "rows"}</summary>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full text-sm">
              <caption className="sr-only">{RECONCILIATION_TITLES[name] ?? name}</caption>
              <thead><tr className="border-b border-foreground/20 text-left">{columns.map((c) => <th key={c} scope="col" className="py-1 pr-3 font-medium">{heading(c)}</th>)}</tr></thead>
              <tbody>
                {check.rows.map((row, n) => <tr key={n} className="border-b border-foreground/10">{columns.map((c) => <td key={c} className="break-all py-1 pr-3">{formatCell(c, row[c], row)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {check.count > check.rows.length ? <p className="mt-1 text-sm opacity-75">{check.count - check.rows.length} more not shown. Narrow the dates to see them.</p> : null}
        </details>
      )}
    </li>
  );
}

function LedgerExport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const valid = DATE.test(from) && DATE.test(to) && to >= from;

  async function run() {
    setPending(true);
    setError(null);
    setDone(null);

    try {
      await downloadLedger(from, to);
      setDone(`The ledger for ${from} to ${to} was downloaded.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="export-heading" className="rounded-md border border-foreground/20 p-4">
      <h2 id="export-heading" className="text-lg font-semibold">Export the ledger</h2>
      <p className="mt-1 text-sm">Every payment and refund in the period as a CSV file for accounting. Exports are recorded in the audit log.</p>
      <FormAlert message={error} />
      {done ? <p role="status" className="mt-2 text-sm text-green-900">{done}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} error={DATE.test(from) && DATE.test(to) && to < from ? "The end can't be before the start." : null} />
        <div className="flex items-end"><Button type="button" variant="outline" className="min-h-11" disabled={!valid || pending} onClick={run}>{pending ? "Preparing…" : "Download CSV"}</Button></div>
      </div>
    </section>
  );
}

export function ReconciliationView({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";
  const range = { from: DATE.test(fromParam) ? fromParam : undefined, to: DATE.test(toParam) && (!DATE.test(fromParam) || toParam >= fromParam) ? toParam : undefined };
  const result = useQuery({ queryKey: ["admin-reconciliation", range], queryFn: ({ signal }) => fetchReconciliation(range, signal), retry: false });
  const set = (change: Partial<typeof range>) => {
    const next = new URLSearchParams();
    const merged = { ...range, ...change };
    if (merged.from) next.set("from", merged.from);
    if (merged.to) next.set("to", merged.to);
    router.replace(`${pathname}${next.size > 0 ? `?${next}` : ""}`);
  };
  const open = result.data ? Object.values(result.data.summary).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Finance</h1>
      <FinanceTabs current="/admin/finance/reconciliation" />
      <form role="search" aria-label="Choose the period" className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <TextField label="From" type="date" value={range.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        <TextField label="To" type="date" value={range.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} hint="Leave both blank for the last 30 days." />
      </form>

      {result.isPending ? <p role="status">Checking the books…</p> : null}
      {result.isError ? <AdminProblem error={result.error} what="the reconciliation" onRetry={() => void result.refetch()} /> : null}
      {result.data ? (
        <>
          <p role="status" className="text-sm" aria-live="polite">
            Checked {result.data.range.from} to {result.data.range.to}: {open === 0 ? "everything agrees." : `${open} ${open === 1 ? "thing needs" : "things need"} a look.`}
          </p>
          <ul aria-label="Checks" className="space-y-3">
            {Object.entries(result.data.checks).map(([name, check]) => <Check key={name} name={name} check={check} />)}
          </ul>
        </>
      ) : null}

      {can(user, "invoices.manage") && can(user, "reports.export") ? <LedgerExport /> : null}
    </div>
  );
}
