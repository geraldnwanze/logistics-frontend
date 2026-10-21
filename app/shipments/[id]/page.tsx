import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ShipmentView } from "@/components/booking/shipment-view";

export const metadata: Metadata = { title: "Your shipment", robots: { index: false, follow: false } };

export default function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Your shipment" wide>
      <Suspense fallback={null}>
        <View params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ShipmentView id={id} />;
}
