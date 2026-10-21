import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/rules/screening", label: "Screening rules" },
  { href: "/admin/rules/documents", label: "Document requirements" },
] as const;

export function RulesTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Rules" className="mb-6 flex flex-wrap gap-1">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.href === current ? "page" : undefined} className={cn("inline-flex h-11 items-center rounded-md border border-foreground/20 px-3 text-sm font-medium hover:bg-foreground/5", tab.href === current && "bg-foreground/10")}>{tab.label}</Link>
      ))}
    </nav>
  );
}
