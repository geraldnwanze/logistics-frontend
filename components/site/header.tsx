import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { CmsImage } from "./cms-image";
import { CmsLink } from "./cms-link";
import { AccountLink } from "./account-link";
import { MobileNav } from "./mobile-nav";
import { getMenu } from "@/lib/cms/api";
import type { MenuItem, SiteSettings } from "@/lib/cms/schemas";
import { cn } from "@/lib/utils";

/** Guest/authenticated-only items need the auth state, which the public shell doesn't have yet. */
function publicItems(items: MenuItem[]): MenuItem[] {
  return items
    .filter((item) => !item.audience || item.audience === "everyone")
    .map((item) => ({ ...item, children: item.children ? publicItems(item.children) : undefined }))
    .filter((item) => item.href || item.children?.length);
}

export async function Header({ settings }: { settings: SiteSettings }) {
  const menu = await getMenu("header");
  const items = publicItems(menu?.items ?? []);
  const { business_name: name, logo } = settings.general;
  const centered = settings.layout.header_style === "centered";

  return (
    <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur-sm">
      <div className={cn("mx-auto flex w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8", settings.layout.header_style === "compact" ? "h-14" : "h-18", centered && "justify-between")}>
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label={`${name} home`}>
          {logo?.url ? <span className="relative block h-9 w-32"><CmsImage media={logo} fill sizes="128px" className="object-contain object-left" priority /></span> : <span className="text-lg">{name}</span>}
        </Link>
        <nav aria-label="Main" className="hidden flex-1 md:block">
          <ul className={cn("flex items-center gap-1", centered && "justify-center")}>
            {items.map((item) => (
              <li key={item.label} className="group relative">
                {item.href ? (
                  <CmsLink href={item.href} className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-foreground/5">{item.label}</CmsLink>
                ) : (
                  <button type="button" className="inline-flex h-11 items-center gap-1 rounded-md px-3 text-sm font-medium hover:bg-foreground/5" aria-haspopup="true">
                    {item.label}<ChevronDown aria-hidden className="size-4" />
                  </button>
                )}
                {item.children?.length ? (
                  <ul className="invisible absolute left-0 top-full min-w-56 rounded-md border border-foreground/10 bg-background p-1 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    {item.children.map((child) => (
                      <li key={child.label}>
                        {child.href ? <CmsLink href={child.href} className="block rounded px-3 py-2 text-sm hover:bg-foreground/5">{child.label}</CmsLink> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <AccountLink />
          <MobileNav items={items} label={name} />
        </div>
      </div>
    </header>
  );
}
