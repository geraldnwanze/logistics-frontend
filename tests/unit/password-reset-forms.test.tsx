import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm, ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/auth/api");

const mocked = vi.mocked(authApi);
const GOOD = "Another-Str0ng-Passphrase";

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("ForgotPasswordForm", () => {
  it("gives the same confirmation whatever the address, without promising an account exists", async () => {
    mocked.requestPasswordReset.mockResolvedValue();
    renderWithClient(<ForgotPasswordForm />);

    await userEvent.type(screen.getByLabelText("Email"), " nobody@example.test ");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(mocked.requestPasswordReset).toHaveBeenCalledWith("nobody@example.test");
    expect(await screen.findByRole("status")).toHaveTextContent(/If an account exists for nobody@example.test/);
  });

  it("reports a failure to send", async () => {
    mocked.requestPasswordReset.mockRejectedValue(new ApiError(429, "too_many_requests", "x"));
    renderWithClient(<ForgotPasswordForm />);

    await userEvent.type(screen.getByLabelText("Email"), "a@b.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many attempts/);
  });
});

describe("ResetPasswordForm", () => {
  function withLink(token = "tok123", email = "ada@example.test") {
    if (token) searchParams.set("token", token);
    if (email) searchParams.set("email", email);
  }

  it("sets the new password using the token from the emailed link, then removes the token from the address bar", async () => {
    withLink();
    const replaceState = vi.spyOn(window.history, "replaceState");
    mocked.resetPassword.mockResolvedValue();
    renderWithClient(<ResetPasswordForm />);

    expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New password"), GOOD);
    await userEvent.type(screen.getByLabelText("Confirm new password"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(mocked.resetPassword).toHaveBeenCalledWith({ token: "tok123", email: "ada@example.test", password: GOOD, password_confirmation: GOOD });
    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("refuses a link with missing parts and offers a new one", () => {
    withLink("", "ada@example.test");
    renderWithClient(<ResetPasswordForm />);

    expect(screen.getByRole("alert")).toHaveTextContent("incomplete");
    expect(screen.getByRole("link", { name: "Request a new one" })).toHaveAttribute("href", "/forgot-password");
  });

  it("catches weak or mismatched passwords before sending", async () => {
    withLink();
    renderWithClient(<ResetPasswordForm />);

    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "other");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByLabelText("New password")).toBeInvalid();
    expect(screen.getByLabelText("Confirm new password")).toBeInvalid();
    expect(mocked.resetPassword).not.toHaveBeenCalled();
  });

  it("explains an expired link and links to a fresh request", async () => {
    withLink();
    mocked.resetPassword.mockRejectedValue(new ApiError(422, "invalid_reset_token", "This password reset link is invalid or has expired."));
    renderWithClient(<ResetPasswordForm />);

    await userEvent.type(screen.getByLabelText("New password"), GOOD);
    await userEvent.type(screen.getByLabelText("Confirm new password"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/);
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("shows the API's complaint about the password itself", async () => {
    withLink();
    mocked.resetPassword.mockRejectedValue(new ApiError(422, "validation_failed", "x", { password: ["That password has appeared in a data leak."] }));
    renderWithClient(<ResetPasswordForm />);

    await userEvent.type(screen.getByLabelText("New password"), GOOD);
    await userEvent.type(screen.getByLabelText("Confirm new password"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("That password has appeared in a data leak.")).toBeInTheDocument();
  });
});
