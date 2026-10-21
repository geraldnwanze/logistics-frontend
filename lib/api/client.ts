import { z } from "zod";

// Literal access so Next.js inlines the public variable into browser code.
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

/** Anything the API (or the network) can say went wrong, in one shape the screens can handle. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** First message for a field, if the API rejected that field. */
  field(name: string): string | undefined {
    return this.fieldErrors[name]?.[0];
  }
}

export type ApiResult<T> = { status: number; body: T };

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Sanctum's SPA protection: have the XSRF cookie (fetch it when missing or rejected), then echo it in a header on every write. */
async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie("XSRF-TOKEN") !== null) return;

  await fetch(`${API_ORIGIN}/sanctum/csrf-cookie`, { credentials: "include", headers: { Accept: "application/json" } });
}

export type RequestOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> };

/**
 * Calls the Laravel API with the session cookie. Throws ApiError for every non-2xx response and for network
 * failures (status 0, code "network"). A 419 (expired CSRF token) is retried once with a fresh token.
 */
export async function apiRequest<T = unknown>(path: string, { method = "GET", body, signal, headers: extraHeaders }: RequestOptions = {}, retried = false): Promise<ApiResult<T>> {
  const write = method !== "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };

  try {
    if (write) {
      await ensureCsrfCookie();
      const token = readCookie("XSRF-TOKEN");
      if (token) headers["X-XSRF-TOKEN"] = token;
      // A file upload sets its own multipart Content-Type (with the boundary); JSON bodies are labelled here.
      if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      method, headers, credentials: "include", signal, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });

    if (response.status === 419 && !retried) {
      await ensureCsrfCookie(true);

      return apiRequest<T>(path, { method, body, signal, headers: extraHeaders }, true);
    }

    const parsed = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
      const envelope = errorEnvelope.safeParse(parsed);

      throw envelope.success
        ? new ApiError(response.status, envelope.data.error.code, envelope.data.error.message, envelope.data.error.errors, envelope.data.error.request_id)
        : new ApiError(response.status, "unexpected_response", "Something went wrong. Please try again.");
    }

    return { status: response.status, body: parsed as T };
  } catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === "AbortError")) throw error;

    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }
}
