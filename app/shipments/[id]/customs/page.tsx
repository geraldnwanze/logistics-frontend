import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { CustomsView } from "@/components/customs/customs-view";

export const metadata: Metadata = { title: "Customs and documents", robots: { index: false, follow: false } };

export default function CustomsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Customs and documents" wide>
      <Suspense fallback={null}>
        <View params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <CustomsView id={id} />;
}
