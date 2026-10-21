import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
