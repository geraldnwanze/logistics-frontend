import { ApiError } from "@/lib/api/client";

/** Plain-language text for anything a form submit can throw. Server messages are used only where they are safe to show. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (error.status === 0) return error.message;
    if (error.status >= 500) return "Something went wrong on our side. Please try again shortly.";

    return error.message;
  }

  return "Something went wrong. Please try again.";
}
