"use client";

import { ClaimsList } from "@/components/claims/claims-list";
import { TicketsList } from "@/components/support/tickets-list";
import { AccountNav } from "./account-nav";
import { RequireUser } from "./require-user";

export function ClaimsScreen() {
  return (
    <RequireUser page="/account/claims">
      {() => (
        <>
          <AccountNav current="/account/claims" />
          <ClaimsList />
        </>
      )}
    </RequireUser>
  );
}

export function SupportScreen() {
  return (
    <RequireUser page="/account/support">
      {() => (
        <>
          <AccountNav current="/account/support" />
          <TicketsList />
        </>
      )}
    </RequireUser>
  );
}
