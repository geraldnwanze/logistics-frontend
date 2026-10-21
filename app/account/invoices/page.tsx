import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesScreen } from "@/components/account/screens";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Your invoices", robots: { index: false, follow: false } };

export default function InvoicesPage() {
  return (
    <AuthCard title="Your invoices" wide>
      <Suspense fallback={null}>
        <InvoicesScreen />
      </Suspense>
    </AuthCard>
  );
}
