import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { BookingFlow } from "@/components/booking/booking-flow";

export const metadata: Metadata = { title: "Book your shipment", robots: { index: false, follow: false } };

export default function BookPage({ params }: { params: Promise<{ quoteId: string }> }) {
  return (
    <AuthCard title="Book your shipment" wide>
      <Suspense fallback={null}>
        <Flow params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function Flow({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return <BookingFlow quoteId={quoteId} />;
}
