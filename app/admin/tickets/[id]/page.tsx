import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Ticket · Back office", robots: { index: false, follow: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Ticket params={params} />
    </Suspense>
  );
}

async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <TicketScreen id={id} />;
}
