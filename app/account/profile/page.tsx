import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileView } from "@/components/account/profile-view";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthCard title="Profile" wide>
      <Suspense fallback={null}>
        <ProfileView />
      </Suspense>
    </AuthCard>
  );
}
