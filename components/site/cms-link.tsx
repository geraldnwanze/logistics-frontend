import Link from "next/link";
import type { ComponentProps } from "react";
import { isExternalHref, isSafeHref } from "@/lib/utils";

type CmsLinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };

/**
 * Renders internal links with next/link and external ones as plain anchors.
 * Unsafe hrefs render as inert text so CMS data can never produce a script URL.
 */
export function CmsLink({ href, children, ...props }: CmsLinkProps) {
  if (!isSafeHref(href)) {
    return <span className={props.className}>{children}</span>;
  }

  if (isExternalHref(href)) {
    return (
      <a href={href} rel="noopener noreferrer" {...(href.startsWith("http") ? { target: "_blank" } : {})} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}
