import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { NewTicketForm } from "@/components/support/new-ticket-form";

export const metadata: Metadata = { title: "Contact support", description: "Ask us a question or tell us about a problem with a shipment.", robots: { index: false, follow: true } };

export default function SupportPage() {
  return (
    <AuthCard title="Contact support" intro="Tell us what's going on and we'll reply by email and here. For a lost or damaged shipment, you can also make a claim from the shipment page.">
      <Suspense fallback={null}>
        <NewTicketForm />
      </Suspense>
    </AuthCard>
  );
}
