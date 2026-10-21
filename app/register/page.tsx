import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/register-form";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Create your account", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Create your account" intro="Book shipments, track them and keep your invoices in one place." footer={<>Already have an account? <Link href="/login" className="underline">Sign in</Link></>}>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthCard>
  );
}
