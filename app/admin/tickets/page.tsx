import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Support tickets · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TicketsScreen />
    </Suspense>
  );
}
