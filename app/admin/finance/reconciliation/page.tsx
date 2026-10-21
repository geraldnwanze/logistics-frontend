import type { Metadata } from "next";
import { Suspense } from "react";
import { ReconciliationScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Reconciliation · Finance · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReconciliationScreen />
    </Suspense>
  );
}
