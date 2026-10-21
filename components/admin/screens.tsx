"use client";

import { CLAIM_READERS } from "@/lib/admin/labels";
import { AdminScreen } from "./admin-shell";
import { ClaimDetail } from "./claim-detail";
import { ComplianceQueue } from "./compliance-queue";
import { StaffDetailView } from "./staff-detail";
import { StaffList } from "./staff-list";
import { RequirementsScreen } from "./requirements-screen";
import { RestrictionsScreen } from "./restrictions-screen";
import { InvoiceDetailView } from "./invoice-detail";
import { InvoicesQueue } from "./invoices-queue";
import { PaymentsQueue } from "./payments-queue";
import { ReconciliationView } from "./reconciliation-view";
import { ShipmentDetailView } from "./shipment-detail";
import { ShipmentsQueue } from "./shipments-queue";
import { ClaimsQueue } from "./claims-queue";
import { TicketDetail } from "./ticket-detail";
import { TicketsQueue } from "./tickets-queue";

export function TicketsScreen() {
  return <AdminScreen page="/admin/tickets" current="/admin/tickets" permissions={["tickets.manage"]}>{() => <TicketsQueue />}</AdminScreen>;
}

export function TicketScreen({ id }: { id: string }) {
  return <AdminScreen page={`/admin/tickets/${id}`} current="/admin/tickets" permissions={["tickets.manage"]}>{(user) => <TicketDetail id={id} userId={user.id} userName={user.name} />}</AdminScreen>;
}

export function ClaimsScreen() {
  return <AdminScreen page="/admin/claims" current="/admin/claims" permissions={CLAIM_READERS}>{() => <ClaimsQueue />}</AdminScreen>;
}

export function ClaimScreen({ id }: { id: string }) {
  return <AdminScreen page={`/admin/claims/${id}`} current="/admin/claims" permissions={CLAIM_READERS}>{(user) => <ClaimDetail id={id} user={user} />}</AdminScreen>;
}

export function ShipmentsScreen() {
  return <AdminScreen page="/admin/shipments" current="/admin/shipments" permissions={["shipments.view"]}>{(user) => <ShipmentsQueue user={user} />}</AdminScreen>;
}

export function ShipmentScreen({ id }: { id: string }) {
  return <AdminScreen page={`/admin/shipments/${id}`} current="/admin/shipments" permissions={["shipments.view"]}>{(user) => <ShipmentDetailView id={id} user={user} />}</AdminScreen>;
}

export function InvoicesScreen() {
  return <AdminScreen page="/admin/finance/invoices" current="/admin/finance/invoices" permissions={["payments.view"]}>{() => <InvoicesQueue />}</AdminScreen>;
}

export function InvoiceScreen({ id }: { id: string }) {
  return <AdminScreen page={`/admin/finance/invoices/${id}`} current="/admin/finance/invoices" permissions={["payments.view"]}>{(user) => <InvoiceDetailView id={id} user={user} />}</AdminScreen>;
}

export function PaymentsScreen() {
  return <AdminScreen page="/admin/finance/payments" current="/admin/finance/invoices" permissions={["payments.view"]}>{() => <PaymentsQueue />}</AdminScreen>;
}

export function ReconciliationScreen() {
  return <AdminScreen page="/admin/finance/reconciliation" current="/admin/finance/invoices" permissions={["payments.view"]}>{(user) => <ReconciliationView user={user} />}</AdminScreen>;
}

export function ComplianceScreen() {
  return <AdminScreen page="/admin/compliance" current="/admin/compliance" permissions={["customs.manage"]}>{() => <ComplianceQueue />}</AdminScreen>;
}

export function ScreeningRulesScreen() {
  return <AdminScreen page="/admin/rules/screening" current="/admin/rules/screening" permissions={["customs.manage"]}>{() => <RestrictionsScreen />}</AdminScreen>;
}

export function DocumentRulesScreen() {
  return <AdminScreen page="/admin/rules/documents" current="/admin/rules/screening" permissions={["customs.manage"]}>{() => <RequirementsScreen />}</AdminScreen>;
}

export function StaffScreen() {
  return <AdminScreen page="/admin/staff" current="/admin/staff" permissions={["users.manage"]}>{(user) => <StaffList user={user} />}</AdminScreen>;
}

export function StaffMemberScreen({ id }: { id: string }) {
  return <AdminScreen page={`/admin/staff/${id}`} current="/admin/staff" permissions={["users.manage"]}>{(user) => <StaffDetailView id={id} user={user} />}</AdminScreen>;
}
