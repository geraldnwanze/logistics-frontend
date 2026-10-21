import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Invoices · Finance · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InvoicesScreen />
    </Suspense>
  );
}
