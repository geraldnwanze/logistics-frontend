import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ClaimDetail } from "@/components/claims/claim-detail";

export const metadata: Metadata = { title: "Your claim", robots: { index: false, follow: false } };

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Your claim" wide>
      <Suspense fallback={null}>
        <Detail params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ClaimDetail id={id} />;
}
