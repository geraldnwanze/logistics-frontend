"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { exportMyData, requestAccountDeletion } from "@/lib/account/api";
import { describeError } from "@/lib/auth/errors";
import type { User } from "@/lib/auth/schemas";

/** Download of everything the API holds about the person, and a request (not an instant deletion) to erase the account. */
export function PrivacyPanel({ user }: { user: User }) {
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(user.profile?.deletion_requested === true);
  const [pending, setPending] = useState(false);

  async function download() {
    setExporting(true);
    setError(null);

    try {
      const data = await exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-data.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletion() {
    setPending(true);
    setError(null);

    try {
      await requestAccountDeletion();
      setRequested(true);
      setConfirming(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="privacy-heading" className="rounded-md border border-foreground/15 p-5">
      <h2 id="privacy-heading" className="text-xl font-semibold">Your data</h2>
      <div className="mt-3 space-y-5">
        <FormAlert message={error} />
        <div>
          <p className="text-sm">Download a copy of the personal data we hold about you: your account, saved addresses and organisations.</p>
          <Button className="mt-2" variant="outline" size="sm" onClick={download} disabled={exporting}>{exporting ? "Preparing…" : "Download my data"}</Button>
        </div>
        <div>
          {requested ? (
            <p role="status" className="rounded-md border border-amber-600/50 bg-amber-50 p-3 text-sm text-amber-950">
              Your account deletion request has been recorded. Our team reviews it, because some records (invoices, customs documents) must be kept for legal reasons, and will contact you.
            </p>
          ) : confirming ? (
            <div role="group" aria-label="Confirm account deletion request" className="space-y-2">
              <p className="text-sm">Ask us to delete your account and personal data? We&apos;ll review the request and contact you. Records we&apos;re legally required to keep will be retained.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={requestDeletion} disabled={pending}>{pending ? "Sending…" : "Yes, request deletion"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm">Want your account and personal data deleted? You can send us a request.</p>
              <Button className="mt-2" variant="outline" size="sm" onClick={() => setConfirming(true)}>Request account deletion</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
