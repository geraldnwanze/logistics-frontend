"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 opacity-80">We couldn&apos;t load this page. Please try again.</p>
      <button type="button" onClick={reset} className="mt-6 inline-flex h-11 items-center rounded-md bg-brand px-5 font-semibold text-brand-foreground">
        Try again
      </button>
    </div>
  );
}
