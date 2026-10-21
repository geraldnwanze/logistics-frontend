import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountNav } from "@/components/account/account-nav";
import { PasswordForm } from "@/components/account/password-form";
import { PrivacyPanel } from "@/components/account/privacy-panel";
import * as accountApi from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import { ada, renderWithClient } from "./auth-support";

vi.mock("@/lib/account/api");
const mocked = vi.mocked(accountApi);
const OLD = "Str0ng-Passphrase-1";
const NEW = "N3w-Str0ng-Passphrase";

async function fill(current = OLD, next = NEW, confirm = NEW) {
  await userEvent.type(screen.getByLabelText("Current password"), current);
  await userEvent.type(screen.getByLabelText("New password", { exact: true }), next);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Change password" }));
}

beforeEach(() => vi.resetAllMocks());

describe("PasswordForm", () => {
  it("changes the password, then empties the fields and says other devices were signed out", async () => {
    mocked.changePassword.mockResolvedValue();
    renderWithClient(<PasswordForm />);

    await fill();

    expect(mocked.changePassword).toHaveBeenCalledWith({ current_password: OLD, password: NEW, password_confirmation: NEW });
    expect(await screen.findByRole("status")).toHaveTextContent("signed out of other devices");
    for (const label of ["Current password", "Confirm new password"]) expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.getByLabelText("New password", { exact: true })).toHaveValue("");
  });

  it.each([
    ["a missing current password", "", NEW, NEW, "Current password", "Enter your current password."],
    ["a short new password", OLD, "Short1a", "Short1a", "New password", "Use at least 12 characters."],
    ["a mismatch", OLD, NEW, "Different-Passphrase-1", "Confirm new password", "The passwords don't match."],
    ["reusing the current password", OLD, OLD, OLD, "New password", "Choose a password different from your current one."],
  ])("catches %s before sending", async (_name, current, next, confirm, label, message) => {
    renderWithClient(<PasswordForm />);
    if (current) await userEvent.type(screen.getByLabelText("Current password"), current);
    await userEvent.type(screen.getByLabelText("New password", { exact: true }), next);
    await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByLabelText(label, { exact: true })).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(mocked.changePassword).not.toHaveBeenCalled();
  });

  it("shows the API's reasons beside the right field and keeps what was typed", async () => {
    mocked.changePassword.mockRejectedValue(new ApiError(422, "validation_failed", "x", { current_password: ["The password is incorrect."] }));
    renderWithClient(<PasswordForm />);

    await fill("wrong-password-Aa1");

    expect(await screen.findByText("The password is incorrect.")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInvalid();
    expect(screen.getByLabelText("Current password")).toHaveValue("wrong-password-Aa1");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a data-leak refusal on the new password", async () => {
    mocked.changePassword.mockRejectedValue(new ApiError(422, "validation_failed", "x", { password: ["The given password has appeared in a data leak."] }));
    renderWithClient(<PasswordForm />);

    await fill();

    expect(await screen.findByText(/appeared in a data leak/)).toBeInTheDocument();
    expect(screen.getByLabelText("New password", { exact: true })).toBeInvalid();
  });

  it("explains throttling", async () => {
    mocked.changePassword.mockRejectedValue(new ApiError(429, "too_many_requests", "x"));
    renderWithClient(<PasswordForm />);

    await fill();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many attempts/);
  });
});

describe("PrivacyPanel", () => {
  const user = { ...ada, profile: { phone: null, locale: "en", timezone: "UTC", preferred_currency: "USD", deletion_requested: false } };

  it("downloads the person's data as a JSON file", async () => {
    mocked.exportMyData.mockResolvedValue({ user: { email: ada.email }, addresses: [], organizations: [] });
    const createObjectURL = vi.fn().mockReturnValue("blob:data");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWithClient(<PrivacyPanel user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toMatchObject({ user: { email: ada.email } });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:data");
  });

  it("reports a failed download", async () => {
    mocked.exportMyData.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<PrivacyPanel user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Download my data" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
  });

  it("asks twice before requesting deletion, and says it is a request that staff review", async () => {
    mocked.requestAccountDeletion.mockResolvedValue();
    renderWithClient(<PrivacyPanel user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Request account deletion" }));
    expect(mocked.requestAccountDeletion).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Confirm account deletion request" })).toHaveTextContent("legally required to keep");

    await userEvent.click(screen.getByRole("button", { name: "Yes, request deletion" }));

    expect(mocked.requestAccountDeletion).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("recorded");
    expect(screen.queryByRole("button", { name: /request account deletion/i })).not.toBeInTheDocument();
  });

  it("lets the person back out", async () => {
    renderWithClient(<PrivacyPanel user={user} />);

    await userEvent.click(screen.getByRole("button", { name: "Request account deletion" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocked.requestAccountDeletion).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Request account deletion" })).toBeInTheDocument();
  });

  it("remembers a request made earlier", () => {
    renderWithClient(<PrivacyPanel user={{ ...user, profile: { ...user.profile, deletion_requested: true } }} />);

    expect(screen.getByRole("status")).toHaveTextContent("request has been recorded");
    expect(screen.queryByRole("button", { name: /request account deletion/i })).not.toBeInTheDocument();
  });
});

describe("AccountNav", () => {
  it("marks the current page", () => {
    renderWithClient(<AccountNav current="/account/profile" />);

    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Password" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/account");
  });
});
