"use client";

import { AccountNav } from "./account-nav";
import { InvoicesList } from "./invoices-list";
import { RequireUser } from "./require-user";
import { ShipmentsList } from "./shipments-list";

export function ShipmentsScreen() {
  return (
    <RequireUser page="/account/shipments">
      {() => (
        <>
          <AccountNav current="/account/shipments" />
          <ShipmentsList />
        </>
      )}
    </RequireUser>
  );
}

export function InvoicesScreen() {
  return (
    <RequireUser page="/account/invoices">
      {() => (
        <>
          <AccountNav current="/account/invoices" />
          <InvoicesList />
        </>
      )}
    </RequireUser>
  );
}
