import type { ReactNode } from "react";
import type { Link } from "@/lib/cms/schemas";
import { buttonVariants } from "@/components/ui/button";
import { CmsLink } from "@/components/site/cms-link";
import { cn } from "@/lib/utils";

export function SectionHeading({ heading, intro, className }: { heading?: string | null; intro?: string | null; className?: string }) {
  if (!heading && !intro) {
    return null;
  }

  return (
    <div className={cn("mb-10 max-w-2xl", className)}>
      {heading ? <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{heading}</h2> : null}
      {intro ? <p className="mt-3 text-lg opacity-80">{intro}</p> : null}
    </div>
  );
}

export function CtaLink({ link, variant = "primary" }: { link: Link; variant?: "primary" | "accent" | "outline" }) {
  if (!link) {
    return null;
  }

  return (
    <CmsLink href={link.href} className={buttonVariants({ variant, size: "lg" })}>
      {link.label}
    </CmsLink>
  );
}

/**
 * Rich text is sanitised by the API (allow-listed tags, safe links); this only
 * styles it. It is never run through any other HTML path.
 */
export function RichHtml({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn("space-y-4 leading-7 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:text-xl [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}
