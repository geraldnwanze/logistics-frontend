import type { CSSProperties, ReactNode } from "react";
import { getSettings } from "@/lib/cms/api";
import { themeVariables } from "@/lib/theme";
import { AnnouncementBar } from "./announcement-bar";
import { Footer } from "./footer";
import { Header } from "./header";

/**
 * Wraps every public page with CMS-driven branding, header, footer and the
 * maintenance switch. Settings are cached and refreshed by /api/revalidate.
 */
export async function SiteShell({ children }: { children: ReactNode }) {
  const settings = await getSettings();

  if (!settings) {
    throw new Error("The CMS settings endpoint returned 404");
  }

  const style = themeVariables(settings.branding) as CSSProperties;

  if (settings.site.maintenance_mode) {
    // `children` must stay in the tree: dropping the page's Suspense boundaries breaks
    // partial-prerender regeneration, which then serves the pre-maintenance page forever.
    return (
      <div style={style} className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-3xl font-semibold">{settings.general.business_name}</h1>
        <p className="max-w-md text-lg opacity-80">{settings.site.maintenance_message ?? "We are carrying out maintenance and will be back shortly."}</p>
        <div hidden inert aria-hidden>{children}</div>
      </div>
    );
  }

  return (
    <div style={style} className="flex min-h-dvh flex-col">
      <AnnouncementBar announcement={settings.announcement} />
      <Header settings={settings} />
      <main id="content" className="flex-1">{children}</main>
      <Footer settings={settings} />
    </div>
  );
}
