import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Reset your password" intro="Enter your email and we will send you a link.">
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
