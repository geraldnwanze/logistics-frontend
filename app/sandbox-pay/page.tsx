import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { SandboxPay } from "@/components/booking/sandbox-pay";

export const metadata: Metadata = { title: "Sandbox payment", robots: { index: false, follow: false } };

export default function SandboxPayPage() {
  return (
    <AuthCard title="Pay for your shipment">
      <Suspense fallback={null}>
        <SandboxPay />
      </Suspense>
    </AuthCard>
  );
}
