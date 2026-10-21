import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Payments · Finance · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaymentsScreen />
    </Suspense>
  );
}
