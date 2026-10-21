import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffFiltersFrom, staffHref, validateInvite } from "@/components/admin/staff-list";
import { StaffMemberScreen, StaffScreen } from "@/components/admin/screens";
import * as staffApi from "@/lib/admin/staff";
import { roleChanges, roleLabel, type Role, type StaffDetail, type StaffRow } from "@/lib/admin/staff";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { staff } from "./admin-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/staff" }));
vi.mock("@/lib/admin/staff", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/staff")>();

  return { ...real, fetchStaff: vi.fn(), fetchStaffMember: vi.fn(), fetchRoles: vi.fn(), inviteStaff: vi.fn(), changeRoles: vi.fn(), suspendStaff: vi.fn(), reactivateStaff: vi.fn(), sendStaffPasswordReset: vi.fn(), resetStaffTwoFactor: vi.fn() };
});
vi.mock("@/lib/auth/api");

const api = vi.mocked(staffApi);
const auth = vi.mocked(authApi);
const page = <T,>(items: T[]) => ({ items, page: 1, lastPage: 1, total: items.length });
const ADMIN = ["users.manage"];

const row = (over: Partial<StaffRow> = {}): StaffRow => ({ id: "U1", name: "Bea Booker", email: "bea@example.test", roles: ["customer-support-agent"], status: "active", two_factor_enabled: true, suspended_at: null, created_at: "2026-10-01T08:00:00Z", ...over });
const detail = (over: Partial<StaffDetail> = {}): StaffDetail => ({ ...row(), permissions: ["tickets.manage", "claims.manage"], ...over });
const ROLES: Role[] = [
  { name: "super-admin", grants_everything: true, permissions: [] },
  { name: "customer-support-agent", grants_everything: false, permissions: ["claims.manage", "tickets.manage"] },
  { name: "finance-officer", grants_everything: false, permissions: ["payments.view", "refunds.approve"] },
  { name: "shipping-agent", grants_everything: false, permissions: ["shipments.view"] },
];

const asAdmin = (roles = ["system-admin"]) => auth.fetchCurrentUser.mockResolvedValue({ ...staff(ADMIN), roles });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  asAdmin();
  api.fetchRoles.mockResolvedValue(ROLES);
});

describe("small helpers", () => {
  it("turns role names into words and works out what a change does", () => {
    expect(roleLabel("customer-support-agent")).toBe("Customer support agent");
    expect(roleChanges(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
    expect(roleChanges(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });

  it("checks an invitation", () => {
    expect(validateInvite({ name: "Sam", email: "sam@example.com", roles: ["shipping-agent"] })).toEqual({});
    expect(validateInvite({ name: " ", email: "nope", roles: [] })).toEqual({ name: "Enter their name.", email: expect.stringMatching(/full email address/), roles: "Choose at least one role." });
    expect(validateInvite({ name: "S", email: "a@b.co", roles: Array(7).fill("x") }).roles).toMatch(/at most six/);
  });

  it("reads and builds filters in the address", () => {
    expect(staffFiltersFrom(new URLSearchParams("status=suspended&role=finance-officer&q=%20bea%20&page=2"))).toEqual({ status: "suspended", role: "finance-officer", q: "bea", page: 2 });
    expect(staffFiltersFrom(new URLSearchParams("status=x&role=<b>"))).toMatchObject({ status: undefined, role: undefined });
    expect(staffHref({})).toBe("/admin/staff");
    expect(staffHref({ status: "active", q: "a b" }, 2)).toBe("/admin/staff?status=active&q=a+b&page=2");
  });
});

describe("staff list", () => {
  const open = () => renderWithClient(<StaffScreen />);

  it("is closed to people who can't manage users", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(["tickets.manage"]));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchStaff).not.toHaveBeenCalled();
  });

  it("lists staff with roles and flags suspended people and missing two-factor", async () => {
    api.fetchStaff.mockResolvedValue(page([row(), row({ id: "U2", name: "Cal Carter", status: "suspended", two_factor_enabled: false, roles: ["finance-officer", "shipping-agent"] })]));
    open();

    const first = (await screen.findByRole("link", { name: "Bea Booker" })).closest("li")!;
    expect(first).toHaveTextContent("bea@example.test");
    expect(first).toHaveTextContent("Customer support agent");
    expect(within(first).getByText("Active")).toBeInTheDocument();
    expect(within(first).queryByText("No two-factor yet")).not.toBeInTheDocument();
    const second = screen.getByRole("link", { name: "Cal Carter" }).closest("li")!;
    expect(second).toHaveTextContent("Finance officer, Shipping agent");
    expect(within(second).getByText("Suspended")).toBeInTheDocument();
    expect(within(second).getByText("No two-factor yet")).toBeInTheDocument();
    expect(screen.getByText("2 people")).toBeInTheDocument();
  });

  it("marks your own row", async () => {
    api.fetchStaff.mockResolvedValue(page([row({ id: "01STAFF", name: "Sam Staff" })]));
    open();

    expect(await screen.findByRole("link", { name: "Sam Staff (you)" })).toBeInTheDocument();
  });

  it("filters through the address", async () => {
    searchParams.set("status", "suspended");
    api.fetchStaff.mockResolvedValue(page([row()]));
    open();
    await screen.findByRole("link", { name: "Bea Booker" });

    expect(api.fetchStaff.mock.calls[0][0]).toMatchObject({ status: "suspended" });
    await userEvent.selectOptions(screen.getByLabelText("Role"), "Finance officer");
    expect(replace).toHaveBeenLastCalledWith("/admin/staff?status=suspended&role=finance-officer");
    await userEvent.type(screen.getByLabelText("Name or email"), "bea");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=bea"));
  });

  it("says when nothing matches and when it can't load", async () => {
    searchParams.set("q", "zzz");
    api.fetchStaff.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([]));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No staff match these filters.")).toBeInTheDocument();
  });

  describe("inviting", () => {
    const openForm = async () => {
      api.fetchStaff.mockResolvedValue(page([row()]));
      open();
      await userEvent.click(await screen.findByRole("button", { name: "Invite a colleague" }));

      return screen.getByRole("form", { name: "Invite a colleague" });
    };

    it("checks the form, asks first, and sends the email in lower case", async () => {
      api.inviteStaff.mockResolvedValue(detail());
      const form = await openForm();
      await userEvent.click(within(form).getByRole("button", { name: "Review invitation" }));
      expect(within(form).getByText("Enter their name.")).toBeInTheDocument();
      expect(within(form).getByText("Choose at least one role.")).toBeInTheDocument();

      await userEvent.type(within(form).getByLabelText("Name"), "Dee Dispatcher");
      await userEvent.type(within(form).getByLabelText("Email"), "Dee@Example.test");
      await userEvent.click(await within(form).findByLabelText("Shipping agent"));
      await userEvent.click(within(form).getByRole("button", { name: "Review invitation" }));
      expect(within(form).getByRole("group", { name: "Confirm invitation" })).toHaveTextContent("Invite Dee Dispatcher (dee@example.test) as Shipping agent?");
      await userEvent.click(within(form).getByRole("button", { name: "Go back" }));
      expect(api.inviteStaff).not.toHaveBeenCalled();

      await userEvent.click(within(form).getByRole("button", { name: "Review invitation" }));
      await userEvent.click(within(form).getByRole("button", { name: "Yes, send the invitation" }));
      await waitFor(() => expect(api.inviteStaff).toHaveBeenCalledWith({ name: "Dee Dispatcher", email: "dee@example.test", roles: ["shipping-agent"] }));
      expect(await screen.findByText("An invitation was sent to dee@example.test.")).toBeInTheDocument();
      expect(screen.queryByRole("form", { name: "Invite a colleague" })).not.toBeInTheDocument();
    });

    it("keeps the super administrator role from people who aren't one", async () => {
      const form = await openForm();

      expect(await within(form).findByLabelText(/Super admin/)).toBeDisabled();
    });

    it("lets a super administrator grant it", async () => {
      asAdmin(["super-admin"]);
      const form = await openForm();

      expect(await within(form).findByLabelText(/Super admin/)).toBeEnabled();
    });

    it("explains an email that is already taken, keeping what was typed", async () => {
      api.inviteStaff.mockRejectedValue(new ApiError(409, "email_taken", "x"));
      const form = await openForm();
      await userEvent.type(within(form).getByLabelText("Name"), "Dee");
      await userEvent.type(within(form).getByLabelText("Email"), "dee@example.test");
      await userEvent.click(await within(form).findByLabelText("Shipping agent"));
      await userEvent.click(within(form).getByRole("button", { name: "Review invitation" }));
      await userEvent.click(within(form).getByRole("button", { name: "Yes, send the invitation" }));

      expect(await within(form).findByRole("alert")).toHaveTextContent("An account with this email already exists.");
      expect(within(form).getByLabelText("Name")).toHaveValue("Dee");
    });
  });
});

describe("a staff member", () => {
  const open = (d: StaffDetail = detail(), actorRoles = ["system-admin"]) => {
    asAdmin(actorRoles);
    api.fetchStaffMember.mockResolvedValue(d);

    return renderWithClient(<StaffMemberScreen id={d.id} />);
  };

  it("shows who they are, what they hold and what that allows", async () => {
    open();

    expect(await screen.findByRole("heading", { name: "Bea Booker" })).toBeInTheDocument();
    expect(screen.getByText("Two-factor on")).toBeInTheDocument();
    expect(screen.getByText("2 permissions from their roles")).toBeInTheDocument();
    expect(await screen.findByLabelText("Customer support agent")).toBeChecked();
    expect(screen.getByLabelText("Finance officer")).not.toBeChecked();
  });

  it("only offers a role change once something changed, and says exactly what it does", async () => {
    api.changeRoles.mockResolvedValue(detail({ roles: ["finance-officer"] }));
    open();
    const review = await screen.findByRole("button", { name: "Review role changes" });
    expect(review).toBeDisabled();

    await userEvent.click(await screen.findByLabelText("Finance officer"));
    await userEvent.click(screen.getByLabelText("Customer support agent"));
    await userEvent.click(review);
    expect(screen.getByRole("group", { name: "Confirm role changes" })).toHaveTextContent("Give Bea Booker: Finance officer. Take away: Customer support agent. This takes effect straight away.");
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(api.changeRoles).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Review role changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, save the roles" }));
    await waitFor(() => expect(api.changeRoles).toHaveBeenCalledWith("U1", ["finance-officer"]));
    expect(await screen.findByText("Bea Booker's roles were saved.")).toBeInTheDocument();
  });

  it("won't save with no roles at all", async () => {
    open();
    await userEvent.click(await screen.findByLabelText("Customer support agent"));

    expect(screen.getByRole("button", { name: "Review role changes" })).toBeDisabled();
    expect(screen.getByText("Choose at least one role.")).toBeInTheDocument();
  });

  it("explains that the last super administrator can't be demoted", async () => {
    api.changeRoles.mockRejectedValue(new ApiError(409, "last_super_admin", "x"));
    open(detail({ roles: ["super-admin"] }), ["super-admin"]);
    await userEvent.click(await screen.findByLabelText(/Super admin/));
    await userEvent.click(screen.getByLabelText("Shipping agent"));
    await userEvent.click(screen.getByRole("button", { name: "Review role changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, save the roles" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("There must always be at least one active super administrator");
  });

  it("describes what each role allows", async () => {
    open();

    const finance = (await screen.findByLabelText("Finance officer")).closest("div")!;
    expect(finance).toHaveTextContent("payments view, refunds approve");
    expect(screen.getByLabelText(/Super admin/).closest("div")).toHaveTextContent("Everything, including managing other administrators.");
  });

  describe("account actions", () => {
    it("suspends only after confirming, saying they're signed out", async () => {
      api.suspendStaff.mockResolvedValue(row({ status: "suspended" }));
      open();
      await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
      expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent("They're signed out right away");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(api.suspendStaff).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, suspend" }));
      await waitFor(() => expect(api.suspendStaff).toHaveBeenCalledWith("U1"));
      expect(await screen.findByText("Bea Booker was suspended.")).toBeInTheDocument();
    });

    it("reactivates a suspended person instead", async () => {
      api.reactivateStaff.mockResolvedValue(row());
      open(detail({ status: "suspended", suspended_at: "2026-10-10T08:00:00Z" }));

      expect(await screen.findByText(/suspended Oct/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Reactivate" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, reactivate" }));
      await waitFor(() => expect(api.reactivateStaff).toHaveBeenCalledWith("U1"));
    });

    it("sends a password reset link to the address on file", async () => {
      api.sendStaffPasswordReset.mockResolvedValue(undefined);
      open();
      await userEvent.click(await screen.findByRole("button", { name: "Send password reset link" }));
      expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent("Email bea@example.test a link");
      await userEvent.click(screen.getByRole("button", { name: "Yes, send the link" }));

      await waitFor(() => expect(api.sendStaffPasswordReset).toHaveBeenCalledWith("U1"));
      expect(await screen.findByText("A password reset link was sent to bea@example.test.")).toBeInTheDocument();
    });

    it("resets two-factor only when they have it, with a warning about who is asking", async () => {
      api.resetStaffTwoFactor.mockResolvedValue(row({ two_factor_enabled: false }));
      const view = open();
      await userEvent.click(await screen.findByRole("button", { name: "Reset two-factor" }));
      expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent("really them asking");
      await userEvent.click(screen.getByRole("button", { name: "Yes, reset two-factor" }));
      await waitFor(() => expect(api.resetStaffTwoFactor).toHaveBeenCalledWith("U1"));
      view.unmount();

      open(detail({ two_factor_enabled: false }));
      await screen.findByRole("heading", { name: "Bea Booker" });
      expect(screen.queryByRole("button", { name: "Reset two-factor" })).not.toBeInTheDocument();
    });

    it("shows the API's reason when an action is refused", async () => {
      api.suspendStaff.mockRejectedValue(new ApiError(409, "last_super_admin", "x"));
      open();
      await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, suspend" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("There must always be at least one active super administrator");
    });
  });

  it("on your own account only offers a password reset", async () => {
    open(detail({ id: "01STAFF", name: "Sam Staff" }));

    expect(await screen.findByRole("note")).toHaveTextContent("This is your own account");
    expect(screen.queryByLabelText("Finance officer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review role changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send password reset link" })).toBeInTheDocument();
    for (const name of ["Suspend", "Reactivate", "Reset two-factor"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("shows a super administrator read-only to an ordinary administrator", async () => {
    open(detail({ roles: ["super-admin"] }), ["system-admin"]);

    expect(await screen.findByRole("note")).toHaveTextContent("Only a super administrator can change a super administrator");
    expect(screen.queryByLabelText("Finance officer")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.getByText("Super admin")).toBeInTheDocument();
  });

  it("copes with someone who isn't staff or is gone", async () => {
    asAdmin();
    api.fetchStaffMember.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<StaffMemberScreen id="nope" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this person");
  });
});
