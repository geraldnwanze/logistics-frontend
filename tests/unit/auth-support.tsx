import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { User } from "@/lib/auth/schemas";

export const push = vi.fn();
export const replace = vi.fn();
export const searchParams = new URLSearchParams();

export const ada: User = { id: "01ADA", name: "Ada Shipper", email: "ada@example.test", email_verified: true, roles: ["individual-customer"], permissions: [], two_factor_enabled: false };

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}
