import type { Metadata } from "next";
import { Suspense } from "react";
import { ClaimScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Claim · Back office", robots: { index: false, follow: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Claim params={params} />
    </Suspense>
  );
}

async function Claim({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ClaimScreen id={id} />;
}
