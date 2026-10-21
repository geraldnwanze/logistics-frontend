import { cacheLife } from "next/cache";
import { CmsLink } from "./cms-link";
import { getMenu } from "@/lib/cms/api";
import type { SiteSettings } from "@/lib/cms/schemas";

const SOCIALS = [
  ["facebook", "Facebook"], ["x", "X"], ["instagram", "Instagram"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"],
] as const;

export async function Footer({ settings }: { settings: SiteSettings }) {
  const menu = await getMenu("footer");
  const groups = (menu?.items ?? []).filter((item) => item.children?.length);
  const { contact, social, general } = settings;
  const socials = SOCIALS.filter(([key]) => social[key]);

  return (
    <footer className="mt-auto border-t border-foreground/10 bg-secondary text-white">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="md:col-span-1">
          <p className="text-lg font-semibold">{general.business_name}</p>
          {general.tagline ? <p className="mt-2 text-sm text-white/75">{general.tagline}</p> : null}
          <address className="mt-4 space-y-1 text-sm not-italic text-white/85">
            {contact.email ? <p><a className="underline-offset-2 hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></p> : null}
            {contact.phone ? <p><a className="underline-offset-2 hover:underline" href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a></p> : null}
            {contact.support_hours ? <p className="text-white/70">{contact.support_hours}</p> : null}
          </address>
        </div>
        {groups.map((group) => (
          <nav key={group.label} aria-label={group.label}>
            <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">{group.label}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {group.children?.map((child) => (
                <li key={child.label}>{child.href ? <CmsLink href={child.href} className="hover:underline underline-offset-2">{child.label}</CmsLink> : null}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 text-sm text-white/70 sm:px-6 lg:px-8">
          <p>© <CurrentYear /> {general.business_name}</p>
          {socials.length ? (
            <ul className="flex gap-4">
              {socials.map(([key, label]) => <li key={key}><CmsLink href={social[key] as string} className="hover:text-white">{label}</CmsLink></li>)}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

/** Cached so the year is stable within a render and refreshed daily. */
async function CurrentYear() {
  "use cache";
  cacheLife("days");

  return new Date().getFullYear();
}
