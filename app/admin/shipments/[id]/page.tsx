import type { Metadata } from "next";
import { Suspense } from "react";
import { ShipmentScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Shipment · Back office", robots: { index: false, follow: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Shipment params={params} />
    </Suspense>
  );
}

async function Shipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ShipmentScreen id={id} />;
}
