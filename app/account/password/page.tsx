import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordView } from "@/components/account/profile-view";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Change password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Change password" wide>
      <Suspense fallback={null}>
        <PasswordView />
      </Suspense>
    </AuthCard>
  );
}
