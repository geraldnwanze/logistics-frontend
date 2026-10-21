"use client";

import Link from "next/link";
import { useCurrentUser } from "@/lib/auth/session";

/** "Sign in" for visitors, "Account" once this browser has a session. Anonymous page views make no API call. */
export function AccountLink() {
  const { data: user } = useCurrentUser();

  return (
    <Link href={user ? "/account" : "/login"} className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-foreground/5">
      {user ? "Account" : "Sign in"}
    </Link>
  );
}
