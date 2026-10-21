"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RequireUser } from "@/components/account/require-user";
import { Container } from "@/components/blocks/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { canAny, CLAIM_READERS } from "@/lib/admin/labels";
import type { User } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", permissions: null },
  { href: "/admin/tickets", label: "Support tickets", permissions: ["tickets.manage"] },
  { href: "/admin/shipments", label: "Shipments", permissions: ["shipments.view"] },
  { href: "/admin/claims", label: "Claims", permissions: CLAIM_READERS },
  { href: "/admin/compliance", label: "Compliance", permissions: ["customs.manage"] },
  { href: "/admin/rules/screening", label: "Rules", permissions: ["customs.manage"] },
  { href: "/admin/staff", label: "Staff", permissions: ["users.manage"] },
  { href: "/admin/finance/invoices", label: "Finance", permissions: ["payments.view"] },
] as const;

export type AdminPath = (typeof LINKS)[number]["href"];

/** True when this person holds a back-office permission that one of these screens uses. */
export const isStaffUser = (user: Pick<User, "permissions">): boolean => LINKS.some((l) => l.permissions !== null && canAny(user, l.permissions));

function NoAccess() {
  return (
    <div role="alert" className="rounded-md border border-foreground/20 p-4">
      <p>Your account doesn&apos;t have access to this part of the back office. Ask an administrator if you think it should.</p>
      <Link href="/account" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-3")}>Back to your account</Link>
    </div>
  );
}

/**
 * Back-office pages: sign-in is required, and so is the permission the page needs. The API enforces both; this only
 * keeps people from being shown screens that would answer "forbidden".
 */
export function AdminScreen({ page, current, permissions, children }: { page: string; current: AdminPath; permissions: readonly string[] | null; children: (user: User) => ReactNode }) {
  return (
    <RequireUser page={page}>
      {(user) => (
        <Container className="max-w-5xl py-10 sm:py-14">
          <p className="text-sm font-medium uppercase tracking-wide opacity-70">Back office</p>
          <nav aria-label="Back office" className="mb-8 mt-2 flex flex-wrap gap-1 border-b border-foreground/10 pb-3">
            {LINKS.filter((l) => l.permissions === null || canAny(user, l.permissions)).map((link) => (
              <Link
                key={link.href} href={link.href} aria-current={link.href === current ? "page" : undefined}
                className={cn("inline-flex h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-foreground/5", link.href === current && "bg-foreground/10")}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {permissions !== null && !canAny(user, permissions) ? <NoAccess /> : children(user)}
        </Container>
      )}
    </RequireUser>
  );
}

/** What went wrong loading something in the back office, in words that say what to do. */
export function AdminProblem({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const api = error instanceof ApiError ? error : null;

  if (api?.code === "two_factor_enrollment_required") {
    return (
      <div role="alert" className="rounded-md border border-foreground/20 p-4">
        <p>Set up two-factor authentication before using the back office.</p>
        <Link href="/account" className={cn(buttonVariants({ size: "sm" }), "mt-3")}>Set it up in your account</Link>
      </div>
    );
  }

  if (api?.status === 403) return <NoAccess />;

  return (
    <div role="alert" className="rounded-md border border-foreground/20 p-4">
      <p>{api?.status === 404 ? `We couldn't find ${what}. It may have been removed.` : `We couldn't load ${what} right now.`}</p>
      {onRetry && api?.status !== 404 ? <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}
