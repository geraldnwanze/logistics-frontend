import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ClaimForm } from "@/components/claims/claim-form";

export const metadata: Metadata = { title: "Make a claim", robots: { index: false, follow: false } };

export default function ClaimFormPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Make a claim" wide>
      <Suspense fallback={null}>
        <Form params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function Form({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ClaimForm shipmentId={id} />;
}
