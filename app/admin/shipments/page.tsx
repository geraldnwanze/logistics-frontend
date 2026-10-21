import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipmentsScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Shipments · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShipmentsScreen />
    </Suspense>
  );
}
