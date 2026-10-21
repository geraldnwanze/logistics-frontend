"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentUser } from "./session";

/**
 * For pages that only make sense signed in: returns the query, and sends signed-out visitors to sign in and
 * back. A failure to reach the server does not count as signed out.
 */
export function useRequiredUser(returnTo: string) {
  const router = useRouter();
  const query = useCurrentUser({ force: true });

  useEffect(() => {
    if (!query.isPending && !query.isError && query.data === null) router.replace(`/login?next=${encodeURIComponent(returnTo)}`);
  }, [query.isPending, query.isError, query.data, router, returnTo]);

  return query;
}
