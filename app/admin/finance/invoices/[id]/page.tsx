import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Invoice · Finance · Back office", robots: { index: false, follow: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Invoice params={params} />
    </Suspense>
  );
}

async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <InvoiceScreen id={id} />;
}
