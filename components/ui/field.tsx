import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type FieldProps = Omit<ComponentProps<"input">, "id"> & { label: string; error?: string | null; hint?: string };

/** A labelled input whose error and hint are announced with it. */
export function TextField({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input
        id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className={cn("h-11 w-full rounded-md border border-foreground/25 bg-background px-3 text-base", error && "border-red-700", className)}
        {...props}
      />
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs opacity-75">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

/** Form-level problem (wrong password, server down) announced to screen readers. */
export function FormAlert({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-md border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">{message}</p> : null;
}

type SelectProps = Omit<ComponentProps<"select">, "id"> & { label: string; error?: string | null; hint?: string };

export function SelectField({ label, error, hint, className, children, ...props }: SelectProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <select
        id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className={cn("h-11 w-full rounded-md border border-foreground/25 bg-background px-3 text-base", error && "border-red-700", className)} {...props}
      >
        {children}
      </select>
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs opacity-75">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
