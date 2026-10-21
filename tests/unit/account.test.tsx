import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountView } from "@/components/auth/account-view";
import { groupSecret, TwoFactorPanel } from "@/components/auth/two-factor-panel";
import { AccountLink } from "@/components/site/account-link";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { saveTracking } from "@/lib/tracking/saved";
import { ada, push, renderWithClient, replace } from "./auth-support";
import { trackingFixture } from "./tracking-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/api");

const mocked = vi.mocked(authApi);
const status = (over = {}) => ({ enabled: false, pending_setup: false, required: false, recovery_codes_remaining: null, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("AccountLink", () => {
  it("offers sign in to visitors without calling the API", () => {
    renderWithClient(<AccountLink />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(mocked.fetchCurrentUser).not.toHaveBeenCalled();
  });

  it("offers the account once this browser has signed in", async () => {
    localStorage.setItem("signed-in-hint", "1");
    mocked.fetchCurrentUser.mockResolvedValue(ada);
    renderWithClient(<AccountLink />);

    expect(await screen.findByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("falls back to sign in, and forgets the hint, when the session has ended", async () => {
    localStorage.setItem("signed-in-hint", "1");
    mocked.fetchCurrentUser.mockResolvedValue(null);
    renderWithClient(<AccountLink />);

    await waitFor(() => expect(localStorage.getItem("signed-in-hint")).toBeNull());
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("AccountView", () => {
  beforeEach(() => mocked.fetchTwoFactorStatus.mockResolvedValue(status()));

  it("shows the person's details", async () => {
    mocked.fetchCurrentUser.mockResolvedValue(ada);
    renderWithClient(<AccountView />);

    expect(await screen.findByText("Ada Shipper")).toBeInTheDocument();
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/isn't verified/)).not.toBeInTheDocument();
  });

  it("sends signed-out visitors to sign in and back", async () => {
    mocked.fetchCurrentUser.mockResolvedValue(null);
    renderWithClient(<AccountView />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=/account"));
  });

  it("does not bounce someone to sign in just because the server could not be reached", async () => {
    mocked.fetchCurrentUser.mockRejectedValue(new ApiError(0, "network", "x"));
    renderWithClient(<AccountView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load your account");
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets an unverified person ask for the email again", async () => {
    mocked.fetchCurrentUser.mockResolvedValue({ ...ada, email_verified: false });
    mocked.resendVerification.mockResolvedValue();
    renderWithClient(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Resend verification email" }));

    expect(await screen.findByText("Verification email sent. Check your inbox.")).toBeInTheDocument();
  });

  it("signs out, wipes what this device saved for them, and goes to the sign-in page", async () => {
    mocked.fetchCurrentUser.mockResolvedValue(ada);
    mocked.logout.mockResolvedValue();
    saveTracking("LG000000000001", trackingFixture());
    localStorage.setItem("signed-in-hint", "1");
    renderWithClient(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(mocked.logout).toHaveBeenCalled();
    expect(localStorage.getItem("tracking:saved:v1")).toBeNull();
    expect(localStorage.getItem("signed-in-hint")).toBeNull();
  });

  it("does not pretend to sign out when the server could not be told", async () => {
    mocked.fetchCurrentUser.mockResolvedValue(ada);
    mocked.logout.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    saveTracking("LG000000000001", trackingFixture());
    localStorage.setItem("signed-in-hint", "1");
    renderWithClient(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you out");
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem("signed-in-hint")).toBe("1");
    expect(localStorage.getItem("tracking:saved:v1")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});

describe("TwoFactorPanel", () => {
  it("groups the setup key so it is easy to type", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("walks through setup: key, confirming code, then recovery codes once", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status());
    mocked.beginTwoFactorSetup.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Stub:a?secret=JBSWY3DPEHPK3PXP" });
    mocked.confirmTwoFactor.mockResolvedValue(["aaaaa-11111", "bbbbb-22222"]);
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    expect(await screen.findByTestId("setup-key")).toHaveTextContent("JBSW Y3DP EHPK 3PXP");
    expect(screen.getByRole("link", { name: /Open in an authenticator app/ })).toHaveAttribute("href", expect.stringMatching(/^otpauth:\/\//));

    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ enabled: true, recovery_codes_remaining: 2 }));
    await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));

    expect(mocked.confirmTwoFactor).toHaveBeenCalledWith("123456");
    const codes = await screen.findByTestId("recovery-codes");
    expect(within(codes).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/won't be shown again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /I've saved my codes/ }));
    expect(screen.queryByTestId("recovery-codes")).not.toBeInTheDocument();
    expect(await screen.findByText(/Recovery codes left:/)).toHaveTextContent("2");
  });

  it("keeps the person in setup when the code is wrong", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status());
    mocked.beginTwoFactorSetup.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" });
    mocked.confirmTwoFactor.mockRejectedValue(new ApiError(422, "invalid_two_factor_code", "x"));
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't correct.");
    expect(screen.getByTestId("setup-key")).toBeInTheDocument();
    expect(screen.queryByTestId("recovery-codes")).not.toBeInTheDocument();
  });

  it("never renders a setup link that is not an authenticator link", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status());
    mocked.beginTwoFactorSetup.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "javascript:alert(1)" });
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await screen.findByTestId("setup-key");

    expect(screen.queryByRole("link", { name: /authenticator app/ })).not.toBeInTheDocument();
  });

  it("tells staff it is required", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ required: true }));
    renderWithClient(<TwoFactorPanel />);

    expect(await screen.findByRole("note")).toHaveTextContent("Your role requires two-factor authentication");
  });

  it("turns it off only with password and code, and reports a wrong password", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ enabled: true, recovery_codes_remaining: 8 }));
    mocked.disableTwoFactor.mockRejectedValueOnce(new ApiError(422, "invalid_password", "x")).mockResolvedValueOnce();
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    const turnOff = screen.getByRole("button", { name: "Turn off two-factor" });
    expect(turnOff).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(turnOff);
    expect(await screen.findByRole("alert")).toHaveTextContent("That password isn't correct.");

    await userEvent.click(screen.getByRole("button", { name: "Turn off two-factor" }));
    expect(mocked.disableTwoFactor).toHaveBeenLastCalledWith({ password: "wrong", code: "123456" });
  });

  it("can turn off with a recovery code instead", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ enabled: true, recovery_codes_remaining: 8 }));
    mocked.disableTwoFactor.mockResolvedValue();
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await userEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.type(screen.getByLabelText("Recovery code"), "aaaaa-bbbbb");
    await userEvent.click(screen.getByRole("button", { name: "Turn off two-factor" }));

    expect(mocked.disableTwoFactor).toHaveBeenCalledWith({ password: "pw", recovery_code: "aaaaa-bbbbb" });
  });

  it("creates new recovery codes after confirming the password, and warns when few are left", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ enabled: true, recovery_codes_remaining: 1 }));
    mocked.regenerateRecoveryCodes.mockResolvedValue(["new-code1", "new-code2"]);
    renderWithClient(<TwoFactorPanel />);

    expect(await screen.findByText(/generate new ones soon/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New recovery codes" }));
    expect(screen.getByText(/current recovery codes will stop working/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Create new codes" }));

    expect(mocked.regenerateRecoveryCodes).toHaveBeenCalledWith("pw");
    expect(await screen.findByTestId("recovery-codes")).toBeInTheDocument();
  });

  it("copies recovery codes and says when copying is not possible", async () => {
    mocked.fetchTwoFactorStatus.mockResolvedValue(status({ enabled: true, recovery_codes_remaining: 3 }));
    mocked.regenerateRecoveryCodes.mockResolvedValue(["aaaaa-11111", "bbbbb-22222"]);
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithClient(<TwoFactorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "New recovery codes" }));
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Create new codes" }));
    await screen.findByTestId("recovery-codes");

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("aaaaa-11111\nbbbbb-22222");
    expect(await screen.findByText("Copied.")).toBeInTheDocument();

    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
  });
});
