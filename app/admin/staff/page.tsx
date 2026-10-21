import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Staff · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StaffScreen />
    </Suspense>
  );
}
