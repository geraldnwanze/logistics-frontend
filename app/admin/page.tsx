import type { Metadata } from "next";
import { AdminHome } from "@/components/admin/admin-home";

export const metadata: Metadata = { title: "Back office", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminHome />;
}
