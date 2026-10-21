import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipmentsScreen } from "@/components/account/screens";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Your shipments", robots: { index: false, follow: false } };

export default function ShipmentsPage() {
  return (
    <AuthCard title="Your shipments" wide>
      <Suspense fallback={null}>
        <ShipmentsScreen />
      </Suspense>
    </AuthCard>
  );
}
