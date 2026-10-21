import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-sm font-semibold tracking-widest text-brand uppercase">404</p>
      <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
      <p className="mt-3 opacity-80">The page you are looking for has moved or no longer exists.</p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-md bg-brand px-5 font-semibold text-brand-foreground">Back to home</Link>
    </div>
  );
}
