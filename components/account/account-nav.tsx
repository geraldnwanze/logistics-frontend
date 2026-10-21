import Link from "next/link";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/shipments", label: "Shipments" },
  { href: "/account/invoices", label: "Invoices" },
  { href: "/account/claims", label: "Claims" },
  { href: "/account/support", label: "Support" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/password", label: "Password" },
] as const;

export function AccountNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Account" className="mb-8 flex flex-wrap gap-1 border-b border-foreground/10 pb-3">
      {LINKS.map((link) => (
        <Link
          key={link.href} href={link.href} aria-current={link.href === current ? "page" : undefined}
          className={cn("inline-flex h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-foreground/5", link.href === current && "bg-foreground/10")}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
