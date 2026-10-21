import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { QuoteForm } from "@/components/quote/quote-form";

export const metadata: Metadata = { title: "Get a shipping quote", description: "See prices and delivery times for your shipment before you book." };

export default function QuotePage() {
  return (
    <AuthCard title="Get a shipping quote" intro="Tell us what you're sending and we'll show every service that can carry it, with the full price." wide>
      <Suspense fallback={null}>
        <QuoteForm />
      </Suspense>
    </AuthCard>
  );
}
