import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/finance/invoices", label: "Invoices" },
  { href: "/admin/finance/payments", label: "Payments" },
  { href: "/admin/finance/reconciliation", label: "Reconciliation" },
] as const;

export function FinanceTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Finance" className="mb-6 flex flex-wrap gap-1">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.href === current ? "page" : undefined} className={cn("inline-flex h-11 items-center rounded-md border border-foreground/20 px-3 text-sm font-medium hover:bg-foreground/5", tab.href === current && "bg-foreground/10")}>{tab.label}</Link>
      ))}
    </nav>
  );
}
