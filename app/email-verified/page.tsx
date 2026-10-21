import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Email verified", robots: { index: false, follow: false } };

/** Where the link in the verification email lands after the API has marked the address as verified. */
export default function EmailVerifiedPage() {
  return (
    <AuthCard title="Email verified" intro="Thanks. Your email address is confirmed.">
      <Link href="/account" className={buttonVariants({ className: "w-full" })}>Go to your account</Link>
    </AuthCard>
  );
}
