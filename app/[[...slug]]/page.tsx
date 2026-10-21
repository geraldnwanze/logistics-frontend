import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RenderBlocks } from "@/components/blocks/render-blocks";
import { getPage } from "@/lib/cms/api";
import { SITE_URL } from "@/lib/env";

type Params = Promise<{ slug?: string[] }>;

function slugFrom(slug?: string[]): string {
  return slug?.length ? slug.map(decodeURIComponent).join("/") : "home";
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = slugFrom((await params).slug);
  const result = await getPage(slug);

  if (result.kind !== "page") {
    return {};
  }

  const { page } = result;
  const path = slug === "home" ? "/" : `/${slug}`;
  const ogImage = typeof page.meta.og_image === "object" && page.meta.og_image ? page.meta.og_image.url : undefined;

  return {
    title: slug === "home" ? { absolute: page.meta.title ?? page.title } : (page.meta.title ?? page.title),
    description: page.meta.description ?? undefined,
    alternates: { canonical: `${SITE_URL}${path}` },
    robots: page.meta.noindex ? { index: false, follow: false } : undefined,
    openGraph: ogImage ? { images: [ogImage] } : undefined,
  };
}

export default function CmsPage({ params }: { params: Params }) {
  return (
    <>
      <Suspense fallback={<PageSkeleton />}>
        <PageContent params={params} />
      </Suspense>
      <DynamicMarker />
    </>
  );
}

/**
 * generateMetadata reads `params`, which is only known per request. This marker tells Next.js
 * that deferring metadata to request time is intentional.
 */
function DynamicMarker() {
  return (
    <Suspense>
      <Connection />
    </Suspense>
  );
}

async function Connection() {
  await connection();

  return null;
}

async function PageContent({ params }: { params: Params }) {
  const slug = slugFrom((await params).slug);

  if (slug === "home" && (await params).slug?.length) {
    permanentRedirect("/");
  }

  const result = await getPage(slug);

  if (result.kind === "redirect") {
    return result.status === 301 ? permanentRedirect(result.to) : redirect(result.to);
  }

  if (result.kind === "not-found") {
    notFound();
  }

  return <RenderBlocks blocks={result.page.blocks} />;
}

function PageSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto max-w-6xl animate-pulse space-y-6 px-4 py-20">
      <div className="h-12 w-2/3 rounded bg-foreground/10" />
      <div className="h-6 w-1/2 rounded bg-foreground/10" />
      <div className="h-64 rounded bg-foreground/10" />
    </div>
  );
}
