import type { Metadata } from "next";
import { Suspense } from "react";
import { RenderBlocks } from "@/components/blocks/render-blocks";
import { getPreviewPage } from "@/lib/cms/api";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

type SearchParams = Promise<{ url?: string | string[] }>;

export default function PreviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="p-8" aria-busy="true">Loading preview…</p>}>
      <PreviewContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PreviewContent({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).url;
  const signedUrl = typeof raw === "string" ? raw : undefined;
  const page = signedUrl ? await getPreviewPage(signedUrl).catch(() => null) : null;

  if (!page) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Preview unavailable</h1>
        <p className="mt-2 opacity-80">This preview link is invalid or has expired. Generate a new one from the CMS.</p>
      </div>
    );
  }

  return (
    <>
      <p role="status" className="bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-slate-900">
        Draft preview — not published
      </p>
      <RenderBlocks blocks={page.blocks} />
    </>
  );
}
