import type { Metadata } from "next";
import { Suspense } from "react";
import { ComplianceScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Compliance · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ComplianceScreen />
    </Suspense>
  );
}
