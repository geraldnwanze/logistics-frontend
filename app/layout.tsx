import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Providers } from "@/components/providers";
import { PwaClient } from "@/components/site/pwa";
import { SiteShell } from "@/components/site/site-shell";
import { getSettings } from "@/lib/cms/api";
import { fontClassNames } from "@/lib/fonts";
import { SITE_URL } from "@/lib/env";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const name = settings?.general.business_name ?? "Logistics";

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: settings?.seo.default_title ?? name, template: `%s | ${name}` },
    description: settings?.seo.default_description ?? settings?.general.tagline ?? undefined,
    icons: { ...(settings?.general.favicon?.url ? { icon: settings.general.favicon.url } : {}), apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    openGraph: { siteName: name, type: "website", images: settings?.seo.default_og_image?.url ? [settings.seo.default_og_image.url] : undefined },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontClassNames} h-full antialiased`}>
      <body className="min-h-full">
        <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2">
          Skip to content
        </a>
        <Providers>
          <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
            <SiteShell>{children}</SiteShell>
          </Suspense>
          <PwaClient />
        </Providers>
      </body>
    </html>
  );
}
