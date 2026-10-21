import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterForm, validateRegistration } from "@/components/auth/register-form";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { ada, push, renderWithClient, replace } from "./auth-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/api");

const mocked = vi.mocked(authApi);
const GOOD = "Str0ng-Passphrase-1";

async function fill(overrides: Partial<Record<"name" | "email" | "phone" | "password" | "confirm", string>> = {}) {
  const v = { name: "Ada Shipper", email: "ada@example.test", phone: "", password: GOOD, confirm: GOOD, ...overrides };
  await userEvent.type(screen.getByLabelText("Full name"), v.name);
  await userEvent.type(screen.getByLabelText("Email"), v.email);
  if (v.phone) await userEvent.type(screen.getByLabelText("Phone (optional)"), v.phone);
  await userEvent.type(screen.getByLabelText("Password", { selector: "input" }), v.password);
  await userEvent.type(screen.getByLabelText("Confirm password"), v.confirm);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("validateRegistration", () => {
  const ok = { name: "Ada", email: "ada@example.test", phone: "", password: GOOD, password_confirmation: GOOD };

  it("accepts a good registration", () => {
    expect(validateRegistration(ok)).toEqual({});
  });

  it.each([
    [{ name: "  " }, "name"], [{ email: "nope" }, "email"], [{ email: "a@b" }, "email"], [{ password: "Short1a", password_confirmation: "Short1a" }, "password"],
    [{ password: "alllowercase12345", password_confirmation: "alllowercase12345" }, "password"], [{ password: "NoDigitsHereAtAll", password_confirmation: "NoDigitsHereAtAll" }, "password"],
    [{ password_confirmation: "Different-Passphrase-1" }, "password_confirmation"],
  ])("flags %j", (change, field) => {
    expect(validateRegistration({ ...ok, ...change })).toHaveProperty(field);
  });
});

describe("RegisterForm", () => {
  it("creates the account, signs in and goes to the account page", async () => {
    mocked.register.mockResolvedValue(ada);
    renderWithClient(<RegisterForm />);

    await fill({ phone: "+234 801 000 0000" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(mocked.register).toHaveBeenCalledWith({ name: "Ada Shipper", email: "ada@example.test", phone: "+234 801 000 0000", password: GOOD, password_confirmation: GOOD });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
    expect(localStorage.getItem("signed-in-hint")).toBe("1");
    expect(screen.getByLabelText("Password", { selector: "input" })).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
  });

  it("explains mistakes next to the field and sends nothing", async () => {
    renderWithClient(<RegisterForm />);

    await fill({ password: "short", confirm: "different" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByLabelText("Password", { selector: "input" })).toHaveAccessibleDescription(/at least 12 characters/i);
    expect(screen.getByLabelText("Password", { selector: "input" })).toBeInvalid();
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription("The passwords don't match.");
    expect(mocked.register).not.toHaveBeenCalled();
  });

  it("shows the API's field errors where they belong", async () => {
    mocked.register.mockRejectedValue(new ApiError(422, "validation_failed", "The given data was invalid.", {
      email: ["The email has already been taken."], password: ["The given password has appeared in a data leak."],
    }));
    renderWithClient(<RegisterForm />);

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("The email has already been taken.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInvalid();
    expect(screen.getByText(/appeared in a data leak/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to a general message for other failures", async () => {
    mocked.register.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<RegisterForm />);

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
  });
});
