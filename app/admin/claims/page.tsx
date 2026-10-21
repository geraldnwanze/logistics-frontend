import type { Metadata } from "next";
import { Suspense } from "react";
import { ClaimsScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Claims · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClaimsScreen />
    </Suspense>
  );
}
