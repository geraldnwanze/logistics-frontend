import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changedFields, ProfileForm } from "@/components/account/profile-form";
import * as accountApi from "@/lib/account/api";
import { ApiError } from "@/lib/api/client";
import { CURRENT_USER_KEY } from "@/lib/auth/session";
import { ada, renderWithClient } from "./auth-support";

vi.mock("@/lib/account/api");
const mocked = vi.mocked(accountApi);

const withProfile = (over = {}) => ({ ...ada, profile: { phone: "+234 801 000 0000", locale: "en", timezone: "Africa/Lagos", preferred_currency: "NGN", ...over } });
const options = { languages: ["en", "fr"], currencies: [{ code: "EUR", name: "Euro", symbol: "€" }, { code: "NGN", name: "Nigerian Naira", symbol: "₦" }, { code: "USD", name: "US Dollar", symbol: "$" }] };

beforeEach(() => {
  vi.resetAllMocks();
  mocked.fetchProfileOptions.mockResolvedValue(options);
});

describe("changedFields", () => {
  const base = { name: "Ada", phone: "123", locale: "en", timezone: "UTC", preferred_currency: "USD" };

  it("is empty when nothing changed, ignoring stray spaces", () => {
    expect(changedFields(base, { ...base, name: "  Ada  ", phone: " 123" })).toEqual({});
  });

  it("includes only what changed, and sends an emptied phone as null", () => {
    expect(changedFields(base, { ...base, name: "Grace", phone: "  " })).toEqual({ name: "Grace", phone: null });
    expect(changedFields(base, { ...base, locale: "fr", preferred_currency: "EUR", timezone: "Europe/Paris" })).toEqual({ locale: "fr", preferred_currency: "EUR", timezone: "Europe/Paris" });
  });
});

describe("ProfileForm", () => {
  it("shows the saved details, with the email read-only and Save disabled until something changes", async () => {
    renderWithClient(<ProfileForm user={withProfile()} />);

    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Shipper");
    expect(screen.getByLabelText("Phone")).toHaveValue("+234 801 000 0000");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Africa/Lagos");
    expect(await screen.findByRole("option", { name: "French (fr)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Currency")).toHaveValue("NGN");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("sends only the changed fields and refreshes the signed-in user", async () => {
    const updated = withProfile({ preferred_currency: "EUR" });
    mocked.updateProfile.mockResolvedValue({ ...updated, name: "Ada Obi" });
    const { client } = renderWithClient(<ProfileForm user={withProfile()} />);
    await screen.findByRole("option", { name: "EUR — Euro" });

    await userEvent.clear(screen.getByLabelText("Full name"));
    await userEvent.type(screen.getByLabelText("Full name"), "Ada Obi");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocked.updateProfile).toHaveBeenCalledWith({ name: "Ada Obi", preferred_currency: "EUR" });
    expect(await screen.findByRole("status")).toHaveTextContent("Your changes have been saved.");
    expect(client.getQueryData<{ name: string }>(CURRENT_USER_KEY)?.name).toBe("Ada Obi");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("clears the saved notice as soon as the person edits again", async () => {
    mocked.updateProfile.mockResolvedValue(withProfile());
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.type(screen.getByLabelText("Phone"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("status");
    await userEvent.type(screen.getByLabelText("Phone"), "1");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("removes the phone number by sending null", async () => {
    mocked.updateProfile.mockResolvedValue(withProfile({ phone: null }));
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.clear(screen.getByLabelText("Phone"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocked.updateProfile).toHaveBeenCalledWith({ phone: null });
  });

  it("will not send an empty name", async () => {
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.clear(screen.getByLabelText("Full name"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByLabelText("Full name")).toHaveAccessibleDescription("Enter your name.");
    expect(mocked.updateProfile).not.toHaveBeenCalled();
  });

  it("shows the API's complaint beside the field and keeps the edits", async () => {
    mocked.updateProfile.mockRejectedValue(new ApiError(422, "validation_failed", "The given data was invalid.", { phone: ["The phone field must not be greater than 30 characters."] }));
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.type(screen.getByLabelText("Phone"), "00000000000000000000000");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/must not be greater than 30/)).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInvalid();
    expect(screen.getByLabelText("Phone")).toHaveValue("+234 801 000 0000" + "00000000000000000000000");
  });

  it("reports a failure to reach the server", async () => {
    mocked.updateProfile.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.type(screen.getByLabelText("Phone"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
  });

  it("keeps working, with the current choices only, when the option lists cannot be loaded", async () => {
    mocked.fetchProfileOptions.mockRejectedValue(new ApiError(0, "network", "x"));
    renderWithClient(<ProfileForm user={withProfile({ locale: "de", preferred_currency: "JPY" })} />);

    expect(await screen.findByRole("note")).toHaveTextContent("couldn't load the full list");
    expect(screen.getByLabelText("Language")).toHaveValue("de");
    expect(screen.getByLabelText("Currency")).toHaveValue("JPY");
  });

  it("still offers a currency that is no longer enabled, so saving does not silently change it", async () => {
    renderWithClient(<ProfileForm user={withProfile({ preferred_currency: "JPY" })} />);

    await screen.findByRole("option", { name: "EUR — Euro" });
    expect(screen.getByLabelText("Currency")).toHaveValue("JPY");
  });

  it("lets the person switch away from a saved choice and back again, even when the browser's list omits it", async () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Africa/Lagos", "Europe/Paris"]);   // like Chromium: no "UTC"
    renderWithClient(<ProfileForm user={withProfile({ timezone: "UTC", locale: "de", preferred_currency: "JPY" })} />);

    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "Europe/Paris");
    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "UTC");
    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Language"), "en");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "de");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "USD");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "JPY");
    expect(screen.getByLabelText("Language")).toHaveValue("de");
    expect(screen.getByLabelText("Currency")).toHaveValue("JPY");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("can fill in this device's time zone", async () => {
    renderWithClient(<ProfileForm user={withProfile({ timezone: "Pacific/Auckland" })} />);
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await userEvent.click(screen.getByRole("button", { name: "Use this device's time zone" }));

    expect(screen.getByLabelText("Time zone")).toHaveValue(device);
  });

  it("copes with an account that has no profile row yet", () => {
    renderWithClient(<ProfileForm user={{ ...ada, profile: null }} />);

    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });
});

describe("saving state", () => {
  it("blocks double submission while saving", async () => {
    let finish: (v: ReturnType<typeof withProfile>) => void = () => {};
    mocked.updateProfile.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithClient(<ProfileForm user={withProfile()} />);

    await userEvent.type(screen.getByLabelText("Phone"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    finish(withProfile({ phone: "+234 801 000 00001" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(mocked.updateProfile).toHaveBeenCalledTimes(1);
  });
});
