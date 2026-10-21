import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { SupportScreen } from "@/components/account/more-screens";

export const metadata: Metadata = { title: "Your support conversations", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Your support conversations" wide>
      <Suspense fallback={null}>
        <SupportScreen />
      </Suspense>
    </AuthCard>
  );
}
