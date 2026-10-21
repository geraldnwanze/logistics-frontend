"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { resendVerification } from "@/lib/auth/api";
import { describeError } from "@/lib/auth/errors";
import { useCurrentUser, useSessionActions } from "@/lib/auth/session";
import { AccountNav } from "@/components/account/account-nav";
import { isStaffUser } from "@/components/admin/admin-shell";
import { TwoFactorPanel } from "./two-factor-panel";

export function AccountView() {
  const router = useRouter();
  const { signOut } = useSessionActions();
  const { data: user, isPending, isError, refetch } = useCurrentUser({ force: true });
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !isError && user === null) router.replace("/login?next=/account");
  }, [isPending, isError, user, router]);

  if (isPending) return <p role="status">Loading your account…</p>;

  if (isError) {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>We couldn&apos;t load your account right now.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  if (!user) return <p role="status">Taking you to sign in…</p>;

  async function sendVerification() {
    try {
      await resendVerification();
      setVerifyNote("Verification email sent. Check your inbox.");
    } catch (caught) {
      setVerifyNote(describeError(caught));
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    setSignOutError(null);

    try {
      await signOut();
      router.push("/login");
    } catch (caught) {
      setSignOutError(`We couldn't sign you out. ${describeError(caught)}`);
      setSigningOut(false);
    }
  }

  return (
    <div>
      <AccountNav current="/account" />
      <div className="space-y-8">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="opacity-70">Name</dt><dd>{user.name}</dd></div>
        <div><dt className="opacity-70">Email</dt><dd className="break-all">{user.email}</dd></div>
        {user.roles.length > 0 ? <div><dt className="opacity-70">Access</dt><dd>{user.roles.join(", ")}</dd></div> : null}
      </dl>

      {!user.email_verified ? (
        <div role="note" className="rounded-md border border-amber-600/50 bg-amber-50 p-4 text-sm text-amber-950">
          <p>Your email address isn&apos;t verified yet. Check your inbox for the link we sent.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={sendVerification}>Resend verification email</Button>
          {verifyNote ? <p role="status" className="mt-2">{verifyNote}</p> : null}
        </div>
      ) : null}

      <TwoFactorPanel />

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/track" className="underline">Track a shipment</Link>
        {isStaffUser(user) ? <Link href="/admin" className="underline">Back office</Link> : null}
        <Button variant="outline" onClick={onSignOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</Button>
      </div>
      {signOutError ? <p role="alert" className="text-sm text-red-900">{signOutError}</p> : null}
      </div>
    </div>
  );
}
