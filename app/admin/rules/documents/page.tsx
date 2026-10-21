import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentRulesScreen } from "@/components/admin/screens";

export const metadata: Metadata = { title: "Document requirements · Back office", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DocumentRulesScreen />
    </Suspense>
  );
}
