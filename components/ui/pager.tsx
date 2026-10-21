import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Previous / next links for a paged list. Links, not buttons, so every page has an address that can be shared and reloaded. */
export function Pager({ page, lastPage, hrefFor }: { page: number; lastPage: number; hrefFor: (page: number) => string }) {
  if (lastPage <= 1) return null;

  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
      {page > 1 ? <Link href={hrefFor(page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>Previous</Link> : <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-40")} aria-hidden>Previous</span>}
      <p className="text-sm" aria-live="polite">Page {page} of {lastPage}</p>
      {page < lastPage ? <Link href={hrefFor(page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>Next</Link> : <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-40")} aria-hidden>Next</span>}
    </nav>
  );
}

export function StatusChip({ label, tone }: { label: string; tone: "good" | "bad" | "warn" | "plain" }) {
  const styles = { good: "bg-green-100 text-green-900", bad: "bg-red-100 text-red-900", warn: "bg-amber-100 text-amber-950", plain: "bg-foreground/10" }[tone];

  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", styles)}>{label}</span>;
}
