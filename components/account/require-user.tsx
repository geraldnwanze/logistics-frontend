"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/auth/schemas";
import { useRequiredUser } from "@/lib/auth/use-required-user";

const subscribeNever = () => () => {};

/** For account pages: waits for the session, sends signed-out visitors to sign in and back, and never mistakes an unreachable server for "signed out". */
export function RequireUser({ page, children }: { page: string; children: (user: User) => ReactNode }) {
  const { data: user, isPending, isError, refetch } = useRequiredUser(page);
  // The server renders this component before any session is known. A page that hydrates late may find the session
  // already fetched by the header, so the first render on the client must still say "loading" or the two disagree.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  if (!hydrated || isPending) return <p role="status">Loading your account…</p>;

  if (isError) {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>We couldn&apos;t load your account right now.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  return user ? <>{children(user)}</> : <p role="status">Taking you to sign in…</p>;
}
