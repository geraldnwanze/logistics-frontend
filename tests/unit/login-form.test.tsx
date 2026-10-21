import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { CURRENT_USER_KEY } from "@/lib/auth/session";
import { ada, push, renderWithClient, replace, searchParams } from "./auth-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/auth/api");

const mocked = vi.mocked(authApi);

async function submitPassword(email = "ada@example.test", password = "Str0ng-Passphrase-1") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("LoginForm", () => {
  it("signs in with a password alone and goes to the account", async () => {
    mocked.login.mockResolvedValue({ kind: "signed-in", user: ada });
    const { client } = renderWithClient(<LoginForm />);

    await submitPassword();

    expect(mocked.login).toHaveBeenCalledWith("ada@example.test", "Str0ng-Passphrase-1");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(ada);
    expect(screen.getByLabelText("Password")).toHaveValue("");   // the page stays mounted after navigation, so nothing secret is left in it
    expect(localStorage.getItem("signed-in-hint")).toBe("1");
  });

  it("returns to the page the visitor came from, but only if it is on this site", async () => {
    mocked.login.mockResolvedValue({ kind: "signed-in", user: ada });
    searchParams.set("next", "/track/LG000000000001");
    renderWithClient(<LoginForm />);
    await submitPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/track/LG000000000001"));
  });

  it("ignores a next address that points elsewhere", async () => {
    mocked.login.mockResolvedValue({ kind: "signed-in", user: ada });
    searchParams.set("next", "https://evil.example/phish");
    renderWithClient(<LoginForm />);
    await submitPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
  });

  it("explains wrong credentials without saying which part was wrong", async () => {
    mocked.login.mockRejectedValue(new ApiError(401, "invalid_credentials", "These credentials do not match our records."));
    renderWithClient(<LoginForm />);

    await submitPassword("ada@example.test", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match");
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(403, "account_suspended", "This account has been suspended."), /suspended/],
    [new ApiError(429, "too_many_requests", "x"), /Too many attempts/],
    [new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."), /couldn't reach the server/],
  ])("shows a clear message for %j", async (error, pattern) => {
    mocked.login.mockRejectedValue(error);
    renderWithClient(<LoginForm />);

    await submitPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
  });

  it("does not submit an empty form", async () => {
    renderWithClient(<LoginForm />);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(mocked.login).not.toHaveBeenCalled();
  });

  describe("second step", () => {
    beforeEach(() => mocked.login.mockResolvedValue({ kind: "two-factor" }));

    it("asks for the code, clears the password from the page, and finishes sign-in with it", async () => {
      mocked.completeTwoFactor.mockResolvedValue(ada);
      renderWithClient(<LoginForm />);
      await submitPassword();

      expect(await screen.findByLabelText("Authentication code")).toHaveFocus();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();

      await userEvent.type(screen.getByLabelText("Authentication code"), "123 456");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(mocked.completeTwoFactor).toHaveBeenCalledWith({ code: "123456" });
      await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
    });

    it("keeps the person on the code step after a wrong code and clears the box", async () => {
      mocked.completeTwoFactor.mockRejectedValue(new ApiError(422, "invalid_two_factor_code", "That code is not correct."));
      renderWithClient(<LoginForm />);
      await submitPassword();
      await userEvent.type(await screen.findByLabelText("Authentication code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't correct");
      expect(screen.getByLabelText("Authentication code")).toHaveValue("");
      expect(push).not.toHaveBeenCalled();
    });

    it("can use a recovery code instead", async () => {
      mocked.completeTwoFactor.mockResolvedValue(ada);
      renderWithClient(<LoginForm />);
      await submitPassword();
      await userEvent.click(await screen.findByRole("button", { name: "Use a recovery code" }));
      await userEvent.type(screen.getByLabelText("Recovery code"), " aaaaa-bbbbb ");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(mocked.completeTwoFactor).toHaveBeenCalledWith({ recovery_code: "aaaaa-bbbbb" });
    });

    it.each([
      ["two_factor_expired", /timed out/],
      ["two_factor_locked", /Too many incorrect codes/],
    ])("goes back to the password step when the server says %s", async (code, pattern) => {
      mocked.completeTwoFactor.mockRejectedValue(new ApiError(401, code, "x"));
      renderWithClient(<LoginForm />);
      await submitPassword();
      await userEvent.type(await screen.findByLabelText("Authentication code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
    });

    it("lets the person start over", async () => {
      renderWithClient(<LoginForm />);
      await submitPassword();
      await userEvent.click(await screen.findByRole("button", { name: "Start over" }));

      expect(screen.getByLabelText("Email")).toBeInTheDocument();
    });
  });
});
