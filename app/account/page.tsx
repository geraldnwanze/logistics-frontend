import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountView } from "@/components/auth/account-view";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Your account" wide>
      <Suspense fallback={null}>
        <AccountView />
      </Suspense>
    </AuthCard>
  );
}
