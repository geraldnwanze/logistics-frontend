import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { TicketThread } from "@/components/support/ticket-thread";

export const metadata: Metadata = { title: "Your conversation", robots: { index: false, follow: false } };

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Support" wide>
      <Suspense fallback={null}>
        <Thread params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <TicketThread id={id} />;
}
