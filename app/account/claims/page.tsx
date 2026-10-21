import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ClaimsScreen } from "@/components/account/more-screens";

export const metadata: Metadata = { title: "Your claims", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Your claims" wide>
      <Suspense fallback={null}>
        <ClaimsScreen />
      </Suspense>
    </AuthCard>
  );
}
