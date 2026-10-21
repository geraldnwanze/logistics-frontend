import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { RequireUser } from "@/components/account/require-user";
import { CURRENT_USER_KEY } from "@/lib/auth/session";
import { ada } from "./auth-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const tree = (client: QueryClient) => (
  <QueryClientProvider client={client}>
    <RequireUser page="/admin/tickets/T1">{(user) => <h1>Hello {user.name}</h1>}</RequireUser>
  </QueryClientProvider>
);

describe("RequireUser on a page the server renders", () => {
  it("hydrates without a mismatch even when the session was already fetched elsewhere on the page", async () => {
    const html = renderToString(tree(new QueryClient()));   // the server: no session known
    expect(html).toContain("Loading your account…");

    const alreadyKnown = new QueryClient();
    alreadyKnown.setQueryData(CURRENT_USER_KEY, ada);        // the header got there first
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const mismatches: unknown[] = [];

    await act(async () => { hydrateRoot(container, tree(alreadyKnown), { onRecoverableError: (e) => mismatches.push(e) }); });

    expect(mismatches).toEqual([]);
    expect(container).toHaveTextContent("Hello Ada Shipper");   // and it still settles on the signed-in view
    container.remove();
  });
});
