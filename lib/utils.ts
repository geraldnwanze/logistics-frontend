import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Only relative paths, anchors, https, mailto and tel links are rendered.
 * The API already enforces this; the check is repeated so a bad record can never become a script URL.
 */
export function isSafeHref(href: string): boolean {
  return /^(\/(?!\/)\S*|#[\w-]+|https?:\/\/\S+|mailto:\S+|tel:\+?[0-9()-]+)$/i.test(href);
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}
