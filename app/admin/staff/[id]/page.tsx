import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffMemberScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Staff member · Back office", robots: { index: false, follow: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Member params={params} />
    </Suspense>
  );
}

async function Member({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <StaffMemberScreen id={id} />;
}
