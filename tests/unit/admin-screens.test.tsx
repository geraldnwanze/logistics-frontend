import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProblem, isStaffUser } from "@/components/admin/admin-shell";
import { ClaimsQueue, claimFiltersFrom, claimsHref } from "@/components/admin/claims-queue";
import { ClaimScreen, ClaimsScreen, TicketScreen, TicketsScreen } from "@/components/admin/screens";
import { filtersFrom, ticketsHref, TicketsQueue } from "@/components/admin/tickets-queue";
import { AdminHome } from "@/components/admin/admin-home";
import * as adminApi from "@/lib/admin/api";
import { can, dueIn } from "@/lib/admin/labels";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import * as download from "@/lib/shipping/download";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { adminClaim, adminTicket, AGENT, APPROVER, claimRow, FINANCE, staff, ticketRow } from "./admin-fixtures";
import { money } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/tickets" }));
vi.mock("@/lib/admin/api");
vi.mock("@/lib/auth/api");
vi.mock("@/lib/shipping/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shipping/download")>()), openSignedLink: vi.fn() }));

const api = vi.mocked(adminApi);
const auth = vi.mocked(authApi);
const page = <T,>(items: T[], over: Partial<{ page: number; lastPage: number; total: number }> = {}) => ({ items, page: 1, lastPage: 1, total: items.length, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  auth.fetchCurrentUser.mockResolvedValue(staff(AGENT));
});

describe("permissions and labels", () => {
  it("knows who is staff and what they may do", () => {
    expect(isStaffUser(staff(AGENT))).toBe(true);
    expect(isStaffUser(staff(["claims.manage"]))).toBe(true);
    expect(isStaffUser(staff([]))).toBe(false);
    expect(can(staff(APPROVER), "claims.approve")).toBe(true);
    expect(can(staff(AGENT), "claims.approve")).toBe(false);
  });

  it("says how long until, or since, a deadline", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");

    expect(dueIn("2026-10-16T12:30:00Z", now)).toBe("due in 30 min");
    expect(dueIn("2026-10-16T09:00:00Z", now)).toBe("3 h overdue");
    expect(dueIn("2026-10-13T12:00:00Z", now)).toBe("3 d overdue");
    expect(dueIn(null, now)).toBeNull();
  });
});

describe("filters in the address", () => {
  it("reads only values the API knows and drops the rest", () => {
    const f = filtersFrom(new URLSearchParams("status=pending_staff&priority=bogus&category=billing&assigned_to=me&breached=1&q=%20parcel%20&page=3"));

    expect(f).toEqual({ status: "pending_staff", priority: undefined, category: "billing", assigned_to: "me", breached: true, q: "parcel", page: 3 });
    expect(filtersFrom(new URLSearchParams("assigned_to=01SOMEONE&page=-1")).assigned_to).toBeUndefined();   // not a person's id
    expect(filtersFrom(new URLSearchParams("assigned_to=01BEA0000000000000000000AA")).assigned_to).toBe("01BEA0000000000000000000AA");
  });

  it("builds the same address back, leaving out defaults", () => {
    expect(ticketsHref({})).toBe("/admin/tickets");
    expect(ticketsHref({ status: "open", breached: true, q: "a b" }, 2)).toBe("/admin/tickets?status=open&breached=1&q=a+b&page=2");
    expect(claimsHref({ status: "approved" })).toBe("/admin/claims?status=approved");
    expect(claimFiltersFrom(new URLSearchParams("status=nonsense&type=loss"))).toMatchObject({ status: undefined, type: "loss" });
  });
});

describe("the back-office guard", () => {
  it("sends signed-out visitors to sign in and back", async () => {
    auth.fetchCurrentUser.mockResolvedValue(null);
    renderWithClient(<TicketsScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fadmin%2Ftickets"));
    expect(api.fetchAdminTickets).not.toHaveBeenCalled();
  });

  it("tells a customer they have no access, without asking the API for anything", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff([]));
    renderWithClient(<TicketsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchAdminTickets).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Support tickets" })).not.toBeInTheDocument();
  });

  it("shows only the sections a person may use", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(["claims.manage"]));
    api.fetchAdminClaims.mockResolvedValue(page([claimRow()]));
    renderWithClient(<ClaimsScreen />);

    const nav = await screen.findByRole("navigation", { name: "Back office" });
    expect(within(nav).getByRole("link", { name: "Claims" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "Support tickets" })).not.toBeInTheDocument();
  });

  it("lets someone who only decides or pays claims read the claim queue, but not the tickets", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(FINANCE));
    api.fetchAdminClaims.mockResolvedValue(page([claimRow()]));
    const view = renderWithClient(<ClaimsScreen />);

    const nav = await screen.findByRole("navigation", { name: "Back office" });
    expect(within(nav).getByRole("link", { name: "Claims" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Support tickets" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Damaged goods/ })).toBeInTheDocument();
    view.unmount();

    renderWithClient(<TicketsScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
  });

  it("explains a missing second factor and where to fix it", () => {
    renderWithClient(<AdminProblem error={new ApiError(403, "two_factor_enrollment_required", "x")} what="the tickets" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Set up two-factor authentication");
    expect(screen.getByRole("link", { name: "Set it up in your account" })).toHaveAttribute("href", "/account");
  });
});

describe("overview", () => {
  it("counts what needs attention and links to it", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(AGENT));
    api.fetchAdminTickets.mockImplementation(async (f) => page([], { total: f.breached ? 2 : 7 }));
    api.fetchAdminClaims.mockImplementation(async (f) => page([], { total: f.status === "approved" ? 1 : 4 }));
    renderWithClient(<AdminHome />);

    const tile = await screen.findByRole("link", { name: /Tickets waiting for our reply/ });
    await waitFor(() => expect(tile).toHaveTextContent("7"));
    expect(tile).toHaveAttribute("href", "/admin/tickets?status=pending_staff");
    expect(screen.getByRole("link", { name: /First reply overdue/ })).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /New claims/ })).toHaveTextContent("4");
    expect(screen.getByRole("link", { name: /waiting to be paid/ })).toHaveTextContent("1");
  });

  it("only counts what the person may see", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(["tickets.manage"]));
    api.fetchAdminTickets.mockResolvedValue(page([], { total: 3 }));
    renderWithClient(<AdminHome />);

    await screen.findByRole("link", { name: /Tickets waiting/ });
    expect(screen.queryByRole("link", { name: /New claims/ })).not.toBeInTheDocument();
    expect(api.fetchAdminClaims).not.toHaveBeenCalled();
  });
});

describe("ticket queue", () => {
  it("lists tickets with who, what, priority and whether the first reply is late", async () => {
    api.fetchAdminTickets.mockResolvedValue(page([ticketRow({ sla_breached: true, priority: "urgent" }), ticketRow({ id: "T2", subject: "Invoice question", requester: { email: "guest@example.test" }, tracking_number: null, status: "pending_customer", first_response_at: "2026-10-16T10:00:00Z" })], { total: 2 }));
    renderWithClient(<TicketsQueue />);

    const first = (await screen.findByRole("link", { name: "Where is my parcel?" })).closest("li")!;
    expect(first).toHaveTextContent("Ada Shipper");
    expect(first).toHaveTextContent("LG000000000001");
    expect(within(first).getByText("Overdue")).toBeInTheDocument();
    expect(within(first).getByText("Urgent")).toBeInTheDocument();
    expect(within(first).getByText("Needs our reply")).toBeInTheDocument();
    const second = screen.getByRole("link", { name: "Invoice question" }).closest("li")!;
    expect(second).toHaveTextContent("guest@example.test");
    expect(second).toHaveTextContent("Waiting for customer");
    expect(second).not.toHaveTextContent("First reply");
    expect(screen.getByText("2 tickets")).toBeInTheDocument();
  });

  it("asks the API for the filters in the address", async () => {
    searchParams.set("status", "open");
    searchParams.set("breached", "1");
    api.fetchAdminTickets.mockResolvedValue(page([]));
    renderWithClient(<TicketsQueue />);

    expect(await screen.findByText("No tickets match these filters.")).toBeInTheDocument();
    expect(api.fetchAdminTickets.mock.calls[0][0]).toMatchObject({ status: "open", breached: true });
    expect(screen.getByLabelText("First reply overdue")).toBeChecked();
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("filters by a colleague, offering the people who can take tickets", async () => {
    api.fetchTicketAssignees.mockResolvedValue([{ id: "01BEA0000000000000000000AA", name: "Bea Agent" }]);
    api.fetchAdminTickets.mockResolvedValue(page([ticketRow({ assigned_to: "01BEA0000000000000000000AA", assignee: { id: "01BEA0000000000000000000AA", name: "Bea Agent" } })]));
    renderWithClient(<TicketsQueue />);

    expect(await screen.findByText("Handled by Bea Agent")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByLabelText("Assigned to")).getByRole("option", { name: "Bea Agent" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "Bea Agent");
    expect(replace).toHaveBeenLastCalledWith("/admin/tickets?assigned_to=01BEA0000000000000000000AA");
  });

  it("changes the address when a filter changes, and goes back to page one", async () => {
    searchParams.set("page", "3");
    api.fetchAdminTickets.mockResolvedValue(page([ticketRow()]));
    renderWithClient(<TicketsQueue />);
    await screen.findByRole("link", { name: "Where is my parcel?" });

    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "me");
    expect(replace).toHaveBeenLastCalledWith("/admin/tickets?assigned_to=me");
    await userEvent.type(screen.getByLabelText("Search"), "refund");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=refund"));
  });

  it("says when there is nothing, and when it could not load", async () => {
    api.fetchAdminTickets.mockResolvedValueOnce(page([]));
    const view = renderWithClient(<TicketsQueue />);
    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
    view.unmount();

    api.fetchAdminTickets.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([ticketRow()]));
    renderWithClient(<TicketsQueue />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Where is my parcel?" })).toBeInTheDocument();
  });
});

describe("ticket detail", () => {
  const open = (user = staff(AGENT)) => {
    auth.fetchCurrentUser.mockResolvedValue(user);

    return renderWithClient(<TicketScreen id="T1" />);
  };

  it("shows the conversation, marking internal notes and staff replies apart", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket({ messages: [
      { id: 1, from: "customer", internal: false, body: "It has not moved.", author: null, created_at: "2026-10-16T09:00:00Z", attachments: [{ id: "A1", name: "photo.jpg", size: 1000, type: "image/jpeg" }] },
      { id: 2, from: "staff", internal: true, body: "Customer is a repeat contact.", author: "01STAFF", created_at: "2026-10-16T09:30:00Z", attachments: [] },
      { id: 3, from: "staff", internal: false, body: "Checking with the carrier.", author: "01STAFF", created_at: "2026-10-16T10:00:00Z", attachments: [] },
    ] }));
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    open();

    const list = await screen.findByRole("list", { name: "Messages" });
    const [customer, internal, reply] = Array.from(list.children) as HTMLElement[];
    expect(customer).toHaveTextContent("Customer");
    expect(internal).toHaveTextContent("Internal note, not visible to the customer");
    expect(reply).toHaveTextContent("Support team");
    expect(screen.getByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/track/LG000000000001");

    await userEvent.click(within(customer).getByRole("button", { name: "Download photo.jpg" }));
    api.fetchAdminTicketAttachmentLink.mockResolvedValue({ url: "x" });
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();
    expect(api.fetchAdminTicketAttachmentLink).toHaveBeenCalledWith("T1", "A1");
  });

  it("replies to the customer and sets what happens next", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.replyToTicketAsStaff.mockResolvedValue(adminTicket({ status: "pending_customer" }));
    open();

    await userEvent.type(await screen.findByLabelText("Reply to the customer"), "We are on it.");
    await userEvent.selectOptions(screen.getByLabelText("After sending, set the ticket to"), "resolved");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(api.replyToTicketAsStaff).toHaveBeenCalledWith("T1", { message: "We are on it.", internal: false, status: "resolved" }, []));
    expect(await screen.findByRole("status")).toHaveTextContent("Reply sent.");
    expect(screen.getByLabelText("Reply to the customer")).toHaveValue("");
  });

  it("keeps a private note private, and offers no status for it", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.replyToTicketAsStaff.mockResolvedValue(adminTicket());
    open();

    await userEvent.type(await screen.findByLabelText("Reply to the customer"), "Check the invoice.");
    await userEvent.click(screen.getByLabelText(/Internal note only/));
    expect(screen.queryByLabelText("After sending, set the ticket to")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(api.replyToTicketAsStaff).toHaveBeenCalled());
    expect(api.replyToTicketAsStaff.mock.calls[0][1]).toMatchObject({ internal: true });
    expect(await screen.findByText("Note added.")).toBeInTheDocument();
  });

  const COLLEAGUES = [{ id: "01STAFF", name: "Sam Staff" }, { id: "01BEA", name: "Bea Agent" }, { id: "01CAL", name: "Cal Agent" }];

  it("assigns the ticket to the person looking at it with one click, and they can hand it back", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.fetchTicketAssignees.mockResolvedValue(COLLEAGUES);
    api.updateTicket.mockResolvedValueOnce(ticketRow({ assigned_to: "01STAFF", assignee: { id: "01STAFF", name: "Sam Staff" } })).mockResolvedValueOnce(ticketRow({ assigned_to: null, assignee: null }));
    open();

    expect(await screen.findByText("Nobody is handling this yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(await screen.findByText("You are handling this.")).toBeInTheDocument();
    expect(api.updateTicket).toHaveBeenLastCalledWith("T1", { assigned_to: "01STAFF" });
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "Nobody");
    expect(await screen.findByText("Nobody is handling this yet.")).toBeInTheDocument();
    expect(api.updateTicket).toHaveBeenLastCalledWith("T1", { assigned_to: null });
  });

  it("offers the colleagues who can take tickets and hands the ticket to the one chosen", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.fetchTicketAssignees.mockResolvedValue(COLLEAGUES);
    api.updateTicket.mockResolvedValue(ticketRow({ assigned_to: "01BEA", assignee: { id: "01BEA", name: "Bea Agent" } }));
    open();

    const select = await screen.findByLabelText("Assigned to");
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Nobody", "Sam Staff (you)", "Bea Agent", "Cal Agent"]));
    await userEvent.selectOptions(select, "Bea Agent");

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledWith("T1", { assigned_to: "01BEA" }));
    expect(await screen.findByText("Assigned to Bea Agent.")).toBeInTheDocument();
    expect(screen.getByText("Bea Agent is handling this.")).toBeInTheDocument();
  });

  it("names the colleague who has it, and still allows taking it over", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket({ assigned_to: "01BEA", assignee: { id: "01BEA", name: "Bea Agent" } }));
    api.fetchTicketAssignees.mockResolvedValue(COLLEAGUES);
    open();

    expect(await screen.findByText("Bea Agent is handling this.")).toBeInTheDocument();
    expect(screen.getByLabelText("Assigned to")).toHaveValue("01BEA");
    expect(screen.getByRole("button", { name: "Assign to me" })).toBeInTheDocument();
  });

  it("still works when the list of colleagues can't be loaded, and keeps showing the current holder", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket({ assigned_to: "01GONE", assignee: { id: "01GONE", name: "Gus Gone" } }));
    api.fetchTicketAssignees.mockRejectedValue(new ApiError(500, "server", "x"));
    open();

    const select = await screen.findByLabelText("Assigned to");
    await waitFor(() => expect(screen.getByText("The list of colleagues couldn't be loaded.")).toBeInTheDocument());
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Nobody", "Sam Staff (you)", "Gus Gone"]);
    expect(select).toHaveValue("01GONE");
  });

  it("changes status and priority straight away", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.updateTicket.mockResolvedValue(ticketRow({ priority: "high" }));
    open();

    await userEvent.selectOptions(await screen.findByLabelText("Priority"), "high");

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledWith("T1", { priority: "high" }));
    expect(await screen.findByText("Priority updated.")).toBeInTheDocument();
  });

  it("shows why a change failed", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket());
    api.updateTicket.mockRejectedValue(new ApiError(422, "validation_failed", "The selected assigned to is invalid."));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "Assign to me" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("takes no reply on a closed ticket", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket({ status: "closed" }));
    open();

    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Reply to the customer")).not.toBeInTheDocument();
  });

  it("copes with a ticket that is gone", async () => {
    api.fetchAdminTicket.mockRejectedValue(new ApiError(404, "not_found", "x"));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this ticket");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows message text as text", async () => {
    api.fetchAdminTicket.mockResolvedValue(adminTicket({ messages: [{ id: 1, from: "customer", internal: false, body: "<img src=x onerror=alert(1)>", author: null, created_at: "2026-10-16T09:00:00Z", attachments: [] }] }));
    open();

    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("claim queue", () => {
  it("lists claims with amounts and status, and filters through the address", async () => {
    api.fetchAdminClaims.mockResolvedValue(page([claimRow(), claimRow({ id: "C2", number: "CLM-2026-000002", status: "approved", approved: money(1500), type: "loss" })]));
    renderWithClient(<ClaimsQueue />);

    const first = (await screen.findByRole("link", { name: /Damaged goods/ })).closest("li")!;
    expect(first).toHaveTextContent("$20.00");
    expect(first).toHaveTextContent("New");
    const second = screen.getByRole("link", { name: /Lost shipment/ }).closest("li")!;
    expect(second).toHaveTextContent("Approved: $15.00");
    expect(second).toHaveTextContent("Approved, to pay");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "approved");
    expect(replace).toHaveBeenLastCalledWith("/admin/claims?status=approved");
  });

  it("says when nothing matches", async () => {
    searchParams.set("type", "loss");
    api.fetchAdminClaims.mockResolvedValue(page([]));
    renderWithClient(<ClaimsQueue />);

    expect(await screen.findByText("No claims match these filters.")).toBeInTheDocument();
    expect(api.fetchAdminClaims.mock.calls[0][0]).toMatchObject({ type: "loss" });
  });
});

describe("claim detail", () => {
  const open = (permissions = AGENT) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(permissions));

    return renderWithClient(<ClaimScreen id="C1" />);
  };

  it("shows the claim, the money and what the customer said", async () => {
    api.fetchAdminClaim.mockResolvedValue(adminClaim({ attachments: [{ id: "A1", name: "crushed.jpg", size: 1000, type: "image/jpeg" }], notes: [{ from: "staff", internal: true, body: "Looks genuine.", created_at: "2026-10-16T10:00:00Z", attachments: [] }] }));
    open();

    expect(await screen.findByRole("heading", { name: /Damaged goods · \$20\.00/ })).toBeInTheDocument();
    const money_ = screen.getByRole("region", { name: "Money" });
    expect(money_).toHaveTextContent("$70.41");
    expect(money_).toHaveTextContent("Insured");
    expect(screen.getByText("The box arrived crushed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download crushed.jpg" })).toBeInTheDocument();
    expect(screen.getByText("Internal note, not visible to the customer")).toBeInTheDocument();
  });

  it("offers only the steps the person may take", async () => {
    api.fetchAdminClaim.mockResolvedValue(adminClaim());
    const agent = open(AGENT);
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pay out" })).not.toBeInTheDocument();
    agent.unmount();

    const approver = open(APPROVER);
    expect(await screen.findByRole("heading", { name: "Decision" })).toBeInTheDocument();
    approver.unmount();

    api.fetchAdminClaim.mockResolvedValue(adminClaim({ status: "approved", approved: money(1500) }));
    open(FINANCE);
    expect(await screen.findByRole("heading", { name: "Pay out" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();   // reading and paying are not managing
    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review" })).not.toBeInTheDocument();
  });

  it("marks a claim under review and asks the customer for more, requiring a message", async () => {
    api.fetchAdminClaim.mockResolvedValue(adminClaim());
    api.reviewClaim.mockResolvedValue(adminClaim({ status: "under_review" }));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "Mark as under review" }));
    await waitFor(() => expect(api.reviewClaim).toHaveBeenCalledWith("C1", "under_review", undefined));
    expect(await screen.findByText("Marked as under review.")).toBeInTheDocument();

    const ask = screen.getByRole("button", { name: "Ask the customer" });
    expect(ask).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Ask the customer for more information"), "Please send the receipt.");
    api.reviewClaim.mockResolvedValue(adminClaim({ status: "info_requested" }));
    await userEvent.click(ask);
    await waitFor(() => expect(api.reviewClaim).toHaveBeenLastCalledWith("C1", "info_requested", "Please send the receipt."));
    expect(await screen.findByText("Waiting for the customer to reply.")).toBeInTheDocument();
  });

  it("adds a private note by default and a customer message only when asked", async () => {
    api.fetchAdminClaim.mockResolvedValue(adminClaim());
    api.addClaimStaffNote.mockResolvedValue(adminClaim());
    open();

    await userEvent.type(await screen.findByLabelText("Internal note"), "Checked the photos.");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(api.addClaimStaffNote).toHaveBeenCalledWith("C1", "Checked the photos.", true, []));

    await userEvent.click(screen.getByLabelText("Show this to the customer"));
    await userEvent.type(screen.getByLabelText("Message to the customer"), "Thanks, reviewing now.");
    await userEvent.click(screen.getByRole("button", { name: "Send to customer" }));
    await waitFor(() => expect(api.addClaimStaffNote).toHaveBeenLastCalledWith("C1", "Thanks, reviewing now.", false, []));
  });

  describe("deciding", () => {
    const decide = async () => {
      api.fetchAdminClaim.mockResolvedValue(adminClaim());
      open(APPROVER);
      await screen.findByRole("heading", { name: "Decision" });
    };

    it("won't approve more than was claimed, or nothing, or half a cent", async () => {
      await decide();
      const amount = screen.getByLabelText("Amount to approve (USD)");
      await userEvent.type(screen.getByLabelText(/Reason/), "Photos support it.");

      await userEvent.clear(amount);
      await userEvent.type(amount, "25.00");
      expect(screen.getByText(/The most you can approve is \$20\.00/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Review decision" })).toBeDisabled();
      await userEvent.clear(amount);
      await userEvent.type(amount, "0");
      expect(screen.getByText("The amount must be more than zero.")).toBeInTheDocument();
      await userEvent.clear(amount);
      await userEvent.type(amount, "10.005");
      expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
      await userEvent.clear(amount);
      await userEvent.type(amount, "15.50");
      expect(screen.getByRole("button", { name: "Review decision" })).toBeEnabled();
    });

    it("needs a reason, then asks to confirm, then approves exactly that amount", async () => {
      await decide();
      expect(screen.getByRole("button", { name: "Review decision" })).toBeDisabled();
      const amount = screen.getByLabelText("Amount to approve (USD)");
      await userEvent.clear(amount);
      await userEvent.type(amount, "15.50");
      await userEvent.type(screen.getByLabelText(/Reason/), "Partly covered.");
      api.decideClaim.mockResolvedValue(adminClaim({ status: "approved", approved: money(1550) }));

      await userEvent.click(screen.getByRole("button", { name: "Review decision" }));
      expect(screen.getByRole("group", { name: "Confirm decision" })).toHaveTextContent("Approve $15.50?");
      expect(api.decideClaim).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

      await waitFor(() => expect(api.decideClaim).toHaveBeenCalledWith("C1", { decision: "approve", approved_amount: "15.50", note: "Partly covered." }));
      expect(await screen.findByText("Claim approved.")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    });

    it("rejects with a reason and no amount", async () => {
      await decide();
      await userEvent.click(screen.getByLabelText("Reject"));
      expect(screen.queryByLabelText("Amount to approve (USD)")).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/Reason/), "Outside the window.");
      api.decideClaim.mockResolvedValue(adminClaim({ status: "rejected" }));

      await userEvent.click(screen.getByRole("button", { name: "Review decision" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, reject" }));

      await waitFor(() => expect(api.decideClaim).toHaveBeenCalledWith("C1", { decision: "reject", note: "Outside the window." }));
    });

    it("explains separation of duties and goes back to the form", async () => {
      await decide();
      await userEvent.type(screen.getByLabelText(/Reason/), "Fine.");
      api.decideClaim.mockRejectedValue(new ApiError(403, "self_approval", "x"));

      await userEvent.click(screen.getByRole("button", { name: "Review decision" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("can't decide a claim you made yourself");
      expect(screen.queryByRole("group", { name: "Confirm decision" })).not.toBeInTheDocument();
    });

    it("reloads when someone else decided first", async () => {
      await decide();
      await userEvent.type(screen.getByLabelText(/Reason/), "Fine.");
      api.decideClaim.mockRejectedValue(new ApiError(409, "claim_state", "x"));
      api.fetchAdminClaim.mockResolvedValue(adminClaim({ status: "rejected" }));

      await userEvent.click(screen.getByRole("button", { name: "Review decision" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("moved on since you opened it");
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument());
    });
  });

  describe("paying out", () => {
    const approved = async () => {
      api.fetchAdminClaim.mockResolvedValue(adminClaim({ status: "approved", approved: money(1500), paid: money(500) }));
      open(FINANCE);
      await screen.findByRole("heading", { name: "Pay out" });
    };

    it("shows what is still owed and asks before moving money", async () => {
      await approved();
      expect(screen.getByText(/To pay: \$10\.00/)).toBeInTheDocument();
      api.payoutClaim.mockResolvedValue(adminClaim({ status: "paid", approved: money(1500), paid: money(1500) }));

      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      expect(screen.getByRole("group", { name: "Confirm payout" })).toHaveTextContent("Refund $10.00 to the customer's original payment method?");
      expect(api.payoutClaim).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));

      await waitFor(() => expect(api.payoutClaim).toHaveBeenCalledWith("C1", { method: "refund" }, expect.any(String)));
      expect(await screen.findByText("Payout recorded.")).toBeInTheDocument();
    });

    it("needs a reference for a manual payout", async () => {
      await approved();
      await userEvent.selectOptions(screen.getByLabelText("How to pay"), "manual");
      expect(screen.getByRole("button", { name: "Review payout" })).toBeDisabled();
      await userEvent.type(screen.getByLabelText("Payment reference"), "BANK-123");
      api.payoutClaim.mockResolvedValue(adminClaim({ status: "paid" }));

      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));

      await waitFor(() => expect(api.payoutClaim).toHaveBeenCalledWith("C1", { method: "manual", reference: "BANK-123" }, expect.any(String)));
    });

    it("retries the same payout under the same key, so a dropped connection can't pay twice", async () => {
      await approved();
      api.payoutClaim.mockRejectedValueOnce(new ApiError(0, "network", "x")).mockResolvedValue(adminClaim({ status: "paid" }));

      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));
      await screen.findByRole("alert");
      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));

      await waitFor(() => expect(api.payoutClaim).toHaveBeenCalledTimes(2));
      expect(api.payoutClaim.mock.calls[1][2]).toBe(api.payoutClaim.mock.calls[0][2]);
    });

    it("uses a new key when what is being paid changes", async () => {
      await approved();
      api.payoutClaim.mockRejectedValue(new ApiError(0, "network", "x"));
      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));
      await screen.findByRole("alert");

      await userEvent.selectOptions(screen.getByLabelText("How to pay"), "manual");
      await userEvent.type(screen.getByLabelText("Payment reference"), "REF");
      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));

      await waitFor(() => expect(api.payoutClaim).toHaveBeenCalledTimes(2));
      expect(api.payoutClaim.mock.calls[1][2]).not.toBe(api.payoutClaim.mock.calls[0][2]);
    });

    it("explains a currency mismatch", async () => {
      await approved();
      api.payoutClaim.mockRejectedValue(new ApiError(422, "currency_mismatch", "x"));

      await userEvent.click(screen.getByRole("button", { name: "Review payout" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, pay out" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Record a manual payout instead");
    });
  });

  it("shows a finished claim without any action panels", async () => {
    api.fetchAdminClaim.mockResolvedValue(adminClaim({ status: "paid", approved: money(1500), paid: money(1500), resolution_note: "Approved for the books.", decided_at: "2026-10-16T11:00:00Z" }));
    open(FINANCE);

    expect(await screen.findByText(/Approved for the books\./)).toBeInTheDocument();
    for (const name of ["Review", "Decision", "Pay out"]) expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
  });
});

describe("staff attachments", () => {
  const file = (name: string, type = "application/pdf") => new File(["%PDF-1.4"], name, { type });
  const upload = (files: File[]) => userEvent.upload(screen.getByTestId("attachment-input"), files, { applyAccept: false });

  beforeEach(() => {
    let n = 0;
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:preview-${++n}`), revokeObjectURL: vi.fn() });
  });

  describe("on a ticket reply", () => {
    const open = () => {
      auth.fetchCurrentUser.mockResolvedValue(staff(AGENT));
      api.fetchAdminTicket.mockResolvedValue(adminTicket());

      return renderWithClient(<TicketScreen id="T1" />);
    };

    it("sends the chosen files with the reply and clears them once it works", async () => {
      api.replyToTicketAsStaff.mockResolvedValue(adminTicket());
      open();
      await userEvent.type(await screen.findByLabelText("Reply to the customer"), "Please use this form.");
      const chosen = [file("form.pdf"), file("map.png", "image/png")];
      await upload(chosen);
      expect(screen.getByText("The customer will be able to download these.")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

      await waitFor(() => expect(api.replyToTicketAsStaff).toHaveBeenCalledWith("T1", expect.objectContaining({ message: "Please use this form.", internal: false }), chosen));
      await waitFor(() => expect(screen.queryByRole("list", { name: "Files to send" })).not.toBeInTheDocument());
    });

    it("says when files on a note stay private to staff", async () => {
      open();
      await screen.findByLabelText("Reply to the customer");

      await userEvent.click(screen.getByLabelText(/Internal note only/));

      expect(screen.getByText("Files on a private note are only visible to staff.")).toBeInTheDocument();
    });

    it("shows the server's words when a file is refused, and keeps the reply and files so they can be fixed", async () => {
      api.replyToTicketAsStaff.mockRejectedValue(new ApiError(422, "unsupported_attachment", "“form.pdf” isn't a PDF, JPEG or PNG file."));
      open();
      await userEvent.type(await screen.findByLabelText("Reply to the customer"), "See attached.");
      await upload([file("form.pdf")]);

      await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

      expect(await screen.findByText("“form.pdf” isn't a PDF, JPEG or PNG file.")).toBeInTheDocument();
      expect(screen.getByLabelText("Reply to the customer")).toHaveValue("See attached.");
      expect(screen.getByRole("list", { name: "Files to send" })).toBeInTheDocument();
    });
  });

  describe("on a claim message", () => {
    const open = () => {
      auth.fetchCurrentUser.mockResolvedValue(staff(AGENT));
      api.fetchAdminClaim.mockResolvedValue(adminClaim());

      return renderWithClient(<ClaimScreen id="C1" />);
    };

    it("sends files with a message to the customer and clears them", async () => {
      api.addClaimStaffNote.mockResolvedValue(adminClaim());
      open();
      await userEvent.click(await screen.findByLabelText("Show this to the customer"));
      await userEvent.type(screen.getByLabelText("Message to the customer"), "Please complete this form.");
      const chosen = [file("claim-form.pdf")];
      await upload(chosen);

      await userEvent.click(screen.getByRole("button", { name: "Send to customer" }));

      await waitFor(() => expect(api.addClaimStaffNote).toHaveBeenCalledWith("C1", "Please complete this form.", false, chosen));
      await waitFor(() => expect(screen.queryByRole("list", { name: "Files to send" })).not.toBeInTheDocument());
    });

    it("keeps an internal note's files private and says so", async () => {
      api.addClaimStaffNote.mockResolvedValue(adminClaim());
      open();
      await screen.findByLabelText("Internal note");

      expect(screen.getByText("Files on an internal note are only visible to staff.")).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Internal note"), "Analysis attached.");
      const chosen = [file("analysis.pdf")];
      await upload(chosen);
      await userEvent.click(screen.getByRole("button", { name: "Add note" }));

      await waitFor(() => expect(api.addClaimStaffNote).toHaveBeenCalledWith("C1", "Analysis attached.", true, chosen));
    });

    it("shows a refused file in the server's words", async () => {
      api.addClaimStaffNote.mockRejectedValue(new ApiError(422, "attachment_too_large", "“big.pdf” is larger than 10 MB."));
      open();
      await userEvent.type(await screen.findByLabelText("Internal note"), "Big file.");
      await upload([file("big.pdf")]);

      await userEvent.click(screen.getByRole("button", { name: "Add note" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("“big.pdf” is larger than 10 MB.");
    });
  });

  describe("the requests themselves", () => {
    const real = () => vi.importActual<typeof import("@/lib/admin/api")>("@/lib/admin/api");
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    beforeEach(() => { document.cookie = "XSRF-TOKEN=t; path=/"; });

    it("stays plain JSON without files", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ok({ data: adminTicket() }));
      vi.stubGlobal("fetch", fetchMock);

      await (await real()).replyToTicketAsStaff("T1", { message: "Hi", internal: true });

      const init = fetchMock.mock.calls[0][1];
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual({ message: "Hi", internal: true });
      vi.unstubAllGlobals();
    });

    it("goes multipart with files, writing booleans the way the API's validator reads them", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ok({ data: adminTicket() }));
      vi.stubGlobal("fetch", fetchMock);
      const mod = await real();

      await mod.replyToTicketAsStaff("T1", { message: "Hi", internal: false, status: "resolved" }, [file("a.pdf"), file("b.pdf")]);
      await mod.replyToTicketAsStaff("T1", { message: "Note", internal: true, status: "resolved" }, [file("c.pdf")]);

      const first = fetchMock.mock.calls[0][1].body as FormData;
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Content-Type");
      expect([first.get("message"), first.get("internal"), first.get("status")]).toEqual(["Hi", "0", "resolved"]);
      expect(first.getAll("attachments[]").map((f) => (f as File).name)).toEqual(["a.pdf", "b.pdf"]);
      const second = fetchMock.mock.calls[1][1].body as FormData;
      expect([second.get("internal"), second.get("status")]).toEqual(["1", null]);   // a private note never changes the ticket's status
      vi.unstubAllGlobals();
    });

    it("sends claim notes the same way", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => ok({ data: adminClaim() }));
      vi.stubGlobal("fetch", fetchMock);

      await (await real()).addClaimStaffNote("C1", "See form", false, [file("form.pdf")]);

      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect([form.get("body"), form.get("internal"), form.getAll("attachments[]").length]).toEqual(["See form", "0", 1]);
      vi.unstubAllGlobals();
    });
  });
});
