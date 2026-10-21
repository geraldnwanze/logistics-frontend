import { CmsLink } from "./cms-link";
import type { SiteSettings } from "@/lib/cms/schemas";
import { cn } from "@/lib/utils";

const TONES = { info: "bg-brand text-brand-foreground", warning: "bg-amber-300 text-slate-900", promo: "bg-accent text-accent-foreground" } as const;

export function AnnouncementBar({ announcement }: { announcement: SiteSettings["announcement"] }) {
  if (!announcement.enabled || !announcement.text) {
    return null;
  }

  return (
    <div role="status" className={cn("px-4 py-2 text-center text-sm font-medium", TONES[announcement.tone])}>
      {announcement.link ? <CmsLink href={announcement.link} className="underline underline-offset-2">{announcement.text}</CmsLink> : announcement.text}
    </div>
  );
}
