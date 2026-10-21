"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TRACKING_PATTERN = /^[A-Za-z0-9-]{6,40}$/;

export function TrackingForm({ placeholder = "Enter your tracking number", tone = "light" }: { placeholder?: string | null; tone?: "light" | "dark" }) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();

    if (!TRACKING_PATTERN.test(trimmed)) {
      setError("Tracking numbers are 6–40 letters, numbers or dashes.");

      return;
    }

    setError(null);
    router.push(`/track/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId} className="sr-only">Tracking number</label>
      <div className="flex gap-2">
        <input
          id={inputId} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder ?? undefined}
          autoComplete="off" inputMode="text" aria-invalid={error !== null} aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn("h-12 min-w-0 flex-1 rounded-md border px-4 text-base", tone === "dark" ? "border-white/30 bg-white text-slate-900" : "border-foreground/25 bg-background")}
        />
        <Button type="submit" variant="accent" size="lg"><Search aria-hidden className="size-4" />Track</Button>
      </div>
      {error ? <p id={`${inputId}-error`} role="alert" className={cn("mt-2 text-sm", tone === "dark" ? "text-amber-200" : "text-red-700")}>{error}</p> : null}
    </form>
  );
}
