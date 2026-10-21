import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { QuoteResults } from "@/components/quote/quote-results";

export const metadata: Metadata = { title: "Your prices", robots: { index: false, follow: false } };

export default function QuoteResultsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AuthCard title="Your prices" wide>
      <Suspense fallback={null}>
        <Results params={params} />
      </Suspense>
    </AuthCard>
  );
}

async function Results({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <QuoteResults id={id} />;
}
