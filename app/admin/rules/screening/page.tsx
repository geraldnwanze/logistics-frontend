import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreeningRulesScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Screening rules · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScreeningRulesScreen />
    </Suspense>
  );
}
