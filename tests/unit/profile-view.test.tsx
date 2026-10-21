import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordView, ProfileView } from "@/components/account/profile-view";
import * as accountApi from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { ada, push, renderWithClient, replace } from "./auth-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/api");
vi.mock("@/lib/account/api");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountApi.fetchProfileOptions).mockResolvedValue({ languages: ["en"], currencies: [{ code: "USD", name: "US Dollar", symbol: "$" }] });
});

describe("account screens", () => {
  it("show the profile form and data panel to a signed-in person", async () => {
    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(ada);
    renderWithClient(<ProfileView />);

    expect(await screen.findByLabelText("Full name")).toHaveValue("Ada Shipper");
    expect(screen.getByRole("heading", { name: "Your data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  });

  it("show the password form", async () => {
    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(ada);
    renderWithClient(<PasswordView />);

    expect(await screen.findByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Password" })).toHaveAttribute("aria-current", "page");
  });

  it.each([[ProfileView, "/account/profile"], [PasswordView, "/account/password"]])("send signed-out visitors to sign in and straight back (%#)", async (View, path) => {
    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(null);
    renderWithClient(<View />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(path)}`));
  });

  it("do not bounce someone to sign in just because the server is unreachable", async () => {
    vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new ApiError(0, "network", "x"));
    renderWithClient(<ProfileView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load your account");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });
});
