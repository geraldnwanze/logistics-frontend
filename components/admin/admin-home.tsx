"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchAdminClaims, fetchAdminTickets } from "@/lib/admin/api";
import { fetchComplianceQueue } from "@/lib/admin/customs";
import { fetchInvoices } from "@/lib/admin/finance";
import { fetchAdminShipments } from "@/lib/admin/shipments";
import { can, canAny, CLAIM_READERS } from "@/lib/admin/labels";
import { AdminProblem, AdminScreen } from "./admin-shell";

function Tile({ href, title, count, note }: { href: string; title: string; count: number | undefined; note: string }) {
  return (
    <li>
      <Link href={href} className="block rounded-md border border-foreground/20 p-4 hover:bg-foreground/5">
        <span className="block text-sm opacity-75">{title}</span>
        <span className="mt-1 block text-3xl font-semibold">{count ?? "…"}</span>
        <span className="mt-1 block text-sm">{note}</span>
      </Link>
    </li>
  );
}

function Counts({ tickets, claims, shipments, finance, customs }: { tickets: boolean; claims: boolean; shipments: boolean; finance: boolean; customs: boolean }) {
  const holds = useQuery({ queryKey: ["admin-compliance", 1], queryFn: ({ signal }) => fetchComplianceQueue(1, signal), enabled: customs, retry: false });
  const overdueInvoices = useQuery({ queryKey: ["admin-invoices", { overdue: true, page: 1 }], queryFn: ({ signal }) => fetchInvoices({ overdue: true, page: 1 }, signal), enabled: finance, retry: false });
  const late = useQuery({ queryKey: ["admin-shipments", { stage: "delayed", page: 1 }], queryFn: ({ signal }) => fetchAdminShipments({ stage: "delayed", page: 1 }, signal), enabled: shipments, retry: false });
  const exceptions = useQuery({ queryKey: ["admin-shipments", { stage: "exceptions", page: 1 }], queryFn: ({ signal }) => fetchAdminShipments({ stage: "exceptions", page: 1 }, signal), enabled: shipments, retry: false });
  const needReply = useQuery({ queryKey: ["admin-tickets", { status: "pending_staff", page: 1 }], queryFn: ({ signal }) => fetchAdminTickets({ status: "pending_staff", page: 1 }, signal), enabled: tickets, retry: false });
  const overdue = useQuery({ queryKey: ["admin-tickets", { breached: true, page: 1 }], queryFn: ({ signal }) => fetchAdminTickets({ breached: true, page: 1 }, signal), enabled: tickets, retry: false });
  const newClaims = useQuery({ queryKey: ["admin-claims", { status: "submitted", page: 1 }], queryFn: ({ signal }) => fetchAdminClaims({ status: "submitted", page: 1 }, signal), enabled: claims, retry: false });
  const toPay = useQuery({ queryKey: ["admin-claims", { status: "approved", page: 1 }], queryFn: ({ signal }) => fetchAdminClaims({ status: "approved", page: 1 }, signal), enabled: claims, retry: false });
  const failed = [needReply, overdue, newClaims, toPay, late, exceptions, overdueInvoices, holds].find((q) => q.isError);

  return (
    <>
      {failed ? <AdminProblem error={failed.error} what="the numbers" /> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {tickets ? <Tile href="/admin/tickets?status=pending_staff" title="Tickets waiting for our reply" count={needReply.data?.total} note="Open the queue" /> : null}
        {tickets ? <Tile href="/admin/tickets?breached=1" title="First reply overdue" count={overdue.data?.total} note="These have waited too long" /> : null}
        {customs ? <Tile href="/admin/compliance" title="Waiting for compliance review" count={holds.data?.total} note="Held until someone decides" /> : null}
        {finance ? <Tile href="/admin/finance/invoices?overdue=1" title="Overdue invoices" count={overdueInvoices.data?.total} note="On account and past their due date" /> : null}
        {shipments ? <Tile href="/admin/shipments?stage=delayed" title="Shipments running late" count={late.data?.total} note="Past their promised date" /> : null}
        {shipments ? <Tile href="/admin/shipments?stage=exceptions" title="Shipments with an exception" count={exceptions.data?.total} note="Need someone to look" /> : null}
        {claims ? <Tile href="/admin/claims?status=submitted" title="New claims" count={newClaims.data?.total} note="Not yet looked at" /> : null}
        {claims ? <Tile href="/admin/claims?status=approved" title="Approved, waiting to be paid" count={toPay.data?.total} note="Needs a payout" /> : null}
      </ul>
    </>
  );
}

export function AdminHome() {
  return (
    <AdminScreen page="/admin" current="/admin" permissions={null}>
      {(user) => {
        const tickets = can(user, "tickets.manage");
        const claims = canAny(user, CLAIM_READERS);
        const shipments = can(user, "shipments.view");
        const finance = can(user, "payments.view");
        const customs = can(user, "customs.manage");

        return (
          <div>
            <h1 className="text-3xl font-semibold">Back office</h1>
            <p className="mt-1 opacity-80">Signed in as {user.name}.</p>
            <div className="mt-6">
              {tickets || claims || shipments || finance || customs ? <Counts tickets={tickets} claims={claims} shipments={shipments} finance={finance} customs={customs} /> : <p role="status" className="rounded-md border border-foreground/20 p-4">Your account doesn&apos;t have access to any back-office screens yet.</p>}
            </div>
          </div>
        );
      }}
    </AdminScreen>
  );
}
