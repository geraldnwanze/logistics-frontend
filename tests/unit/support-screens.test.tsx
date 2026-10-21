import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewTicketForm, validateTicket } from "@/components/support/new-ticket-form";
import { TicketsList } from "@/components/support/tickets-list";
import { TicketThread } from "@/components/support/ticket-thread";
import * as authApi from "@/lib/auth/api";
import { ApiError } from "@/lib/api/client";
import * as supportApi from "@/lib/support/api";
import { ticketStatus } from "@/lib/support/labels";
import { ticketTokenFor } from "@/lib/support/tokens";
import { ada, push, renderWithClient, replace, searchParams } from "./auth-support";
import { paged } from "./shipping-fixtures";
import { ticket } from "./support-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/support/api");
vi.mock("@/lib/auth/api");

const api = vi.mocked(supportApi);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("ticketStatus", () => {
  it.each([["open", "Open"], ["pending_staff", "Waiting for our team"], ["pending_customer", "Waiting for your reply"], ["resolved", "Resolved"], ["closed", "Closed"], ["brand_new", "brand new"]])("describes %s as %s", (status, text) => {
    expect(ticketStatus(status).text).toBe(text);
  });

  it("flags the one that needs the customer", () => {
    expect(ticketStatus("pending_customer").tone).toBe("warn");
  });
});

describe("validateTicket", () => {
  const ok = { category: "general", tracking: "", subject: "Hello", message: "A question", email: "a@b.test" };

  it("accepts a complete message and needs no email once signed in", () => {
    expect(validateTicket(ok, false)).toEqual({});
    expect(validateTicket({ ...ok, email: "" }, true)).toEqual({});
  });

  it.each([[{ subject: " " }, "subject"], [{ message: "" }, "message"], [{ subject: "x".repeat(201) }, "subject"], [{ message: "x".repeat(5001) }, "message"], [{ tracking: "ab" }, "tracking"], [{ tracking: "<script>" }, "tracking"], [{ email: "nope" }, "email"]])("flags %j", (change, field) => {
    expect(validateTicket({ ...ok, ...change }, false)).toHaveProperty(field);
  });
});

describe("NewTicketForm", () => {
  const fill = async (over: { subject?: string; message?: string; email?: string } = {}) => {
    await userEvent.type(screen.getByLabelText("Subject"), over.subject ?? "Where is my parcel?");
    await userEvent.type(screen.getByLabelText("How can we help?"), over.message ?? "It has not moved.");
    if (over.email !== undefined || !localStorage.getItem("signed-in-hint")) await userEvent.type(screen.getByLabelText("Your email"), over.email ?? "guest@example.test");
  };

  it("opens a ticket as a guest, keeps the one-time token for this tab only, and goes to the conversation", async () => {
    api.openTicket.mockResolvedValue({ ...ticket(), access_token: "secret-ticket-token" });
    renderWithClient(<NewTicketForm />);

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/support/tickets/T1"));
    expect(api.openTicket).toHaveBeenCalledWith({ subject: "Where is my parcel?", category: "general", message: "It has not moved.", email: "guest@example.test" }, undefined, []);
    expect(ticketTokenFor("T1")).toBe("secret-ticket-token");
    expect(JSON.stringify(push.mock.calls)).not.toContain("secret-ticket-token");
  });

  it("does not ask a signed-in customer for an email, and sends none", async () => {
    localStorage.setItem("signed-in-hint", "1");
    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(ada);
    api.openTicket.mockResolvedValue(ticket());
    renderWithClient(<NewTicketForm />);
    await waitFor(() => expect(screen.queryByLabelText("Your email")).not.toBeInTheDocument());

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(api.openTicket).toHaveBeenCalled());
    expect(api.openTicket.mock.calls[0][0]).not.toHaveProperty("email");
    expect(ticketTokenFor("T1")).toBeNull();
  });

  it("starts from a shipment when linked from one: category and tracking number filled in", () => {
    searchParams.set("shipment", "LG000000000001");
    renderWithClient(<NewTicketForm />);

    expect(screen.getByLabelText("What is this about?")).toHaveValue("shipment");
    expect(screen.getByLabelText(/Tracking number/)).toHaveValue("LG000000000001");
  });

  it("proves a guest's tracking number is theirs by passing the shipment it came from", async () => {
    searchParams.set("shipment", "LG000000000001");
    searchParams.set("ref", "S1");
    api.openTicket.mockResolvedValue(ticket());
    renderWithClient(<NewTicketForm />);
    await fill();

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(api.openTicket).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: "LG000000000001" }), "S1", []));
  });

  it("ignores a category it doesn't know", () => {
    searchParams.set("category", "bogus");
    renderWithClient(<NewTicketForm />);

    expect(screen.getByLabelText("What is this about?")).toHaveValue("general");
  });

  it("cleans up a tracking number the way the tracking page does", async () => {
    api.openTicket.mockResolvedValue(ticket());
    renderWithClient(<NewTicketForm />);
    await fill();
    await userEvent.type(screen.getByLabelText(/Tracking number/), "lg-0000 00000001");

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(api.openTicket.mock.calls[0][0]).toMatchObject({ tracking_number: "LG000000000001" }));
  });

  it("points at what's missing instead of sending", async () => {
    renderWithClient(<NewTicketForm />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(screen.getByLabelText("Subject")).toBeInvalid();
    expect(screen.getByLabelText("How can we help?")).toBeInvalid();
    expect(screen.getByLabelText("Your email")).toBeInvalid();
    expect(api.openTicket).not.toHaveBeenCalled();
  });

  it("shows the API's reason when the shipment isn't theirs, without saying whether it exists", async () => {
    api.openTicket.mockRejectedValue(new ApiError(422, "validation_failed", "x", { tracking_number: ["We could not find that shipment on your account."] }));
    renderWithClient(<NewTicketForm />);
    await fill();
    await userEvent.type(screen.getByLabelText(/Tracking number/), "LG999999999999");

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("We could not find that shipment on your account.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Tracking number/)).toBeInvalid();
  });

  it("keeps what was typed when sending fails", async () => {
    api.openTicket.mockRejectedValue(new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."));
    renderWithClient(<NewTicketForm />);
    await fill();

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
    expect(screen.getByLabelText("How can we help?")).toHaveValue("It has not moved.");
  });
});

describe("TicketThread", () => {
  it("shows the conversation, who said what, the status and the shipment", async () => {
    api.fetchTicket.mockResolvedValue(ticket({ status: "pending_customer", messages: [
      { from: "customer", body: "It has not moved.", created_at: "2026-10-16T09:00:00Z", attachments: [] }, { from: "staff", body: "We're chasing the carrier.", created_at: "2026-10-16T10:00:00Z", attachments: [] },
    ] }));
    renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByRole("heading", { name: "Where is my parcel?" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for your reply")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/track/LG000000000001");
    const messages = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(messages[0]).toHaveTextContent("You");
    expect(messages[1]).toHaveTextContent("Support team");
    expect(messages[1]).toHaveTextContent("We're chasing the carrier.");
  });

  it("renders message text as text, not markup", async () => {
    api.fetchTicket.mockResolvedValue(ticket({ messages: [{ from: "customer", body: "<img src=x onerror=alert(1)> & more", created_at: "2026-10-16T09:00:00Z", attachments: [] }] }));
    const { container } = renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByText("<img src=x onerror=alert(1)> & more")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("sends a reply and shows it", async () => {
    api.fetchTicket.mockResolvedValue(ticket());
    api.replyToTicket.mockResolvedValue(ticket({ messages: [...ticket().messages, { from: "customer", body: "Any news?", created_at: "2026-10-16T11:00:00Z", attachments: [] }] }));
    renderWithClient(<TicketThread id="T1" />);

    await userEvent.type(await screen.findByLabelText("Your reply"), "  Any news?  ");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(api.replyToTicket).toHaveBeenCalledWith("T1", "Any news?", []);
    expect(await screen.findByText("Any news?")).toBeInTheDocument();
    expect(screen.getByLabelText("Your reply")).toHaveValue("");
  });

  it("won't send an empty reply", async () => {
    api.fetchTicket.mockResolvedValue(ticket());
    renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByRole("button", { name: "Send reply" })).toBeDisabled();
  });

  it("warns that replying to a resolved ticket reopens it", async () => {
    api.fetchTicket.mockResolvedValue(ticket({ status: "resolved" }));
    renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByText(/Replying will reopen it/)).toBeInTheDocument();
  });

  it("asks before closing, and then closes", async () => {
    api.fetchTicket.mockResolvedValueOnce(ticket()).mockResolvedValue(ticket({ status: "closed" }));
    api.closeTicket.mockResolvedValue({ id: "T1", number: "x", subject: "x", category: "general", status: "closed", last_activity_at: "2026-10-16T09:00:00Z" });
    renderWithClient(<TicketThread id="T1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Close this ticket" }));
    expect(api.closeTicket).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, close it" }));

    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your reply")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a new one" })).toHaveAttribute("href", "/support");
  });

  it("lets the customer change their mind about closing", async () => {
    api.fetchTicket.mockResolvedValue(ticket());
    renderWithClient(<TicketThread id="T1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Close this ticket" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep open" }));

    expect(screen.getByRole("button", { name: "Close this ticket" })).toBeInTheDocument();
  });

  it("handles a ticket that was closed while the customer was typing", async () => {
    api.fetchTicket.mockResolvedValueOnce(ticket()).mockResolvedValue(ticket({ status: "closed" }));
    api.replyToTicket.mockRejectedValue(new ApiError(409, "ticket_closed", "This ticket is closed. Please open a new one."));
    renderWithClient(<TicketThread id="T1" />);

    await userEvent.type(await screen.findByLabelText("Your reply"), "Hello?");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText(/has just been closed/)).toBeInTheDocument();
    expect(await screen.findByText(/This ticket is closed\. /)).toBeInTheDocument();
  });

  it("explains an unknown conversation to a guest whose tab was closed, and points to support", async () => {
    api.fetchTicket.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("same browser tab");
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/support");
  });

  it("offers a retry for other failures", async () => {
    api.fetchTicket.mockRejectedValue(new ApiError(500, "server_error", "x"));
    renderWithClient(<TicketThread id="T1" />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("TicketsList", () => {
  it("lists conversations with status and a link to each, and offers a new message", async () => {
    api.fetchTickets.mockResolvedValue(paged([ticket(), ticket({ id: "T2", number: "TKT-2026-000002", subject: "Invoice query", category: "billing", status: "resolved" })]));
    renderWithClient(<TicketsList />);

    const first = (await screen.findByRole("link", { name: "Where is my parcel?" })).closest("li")!;
    expect(first).toHaveTextContent("TKT-2026-000001");
    expect(first).toHaveTextContent("A shipment");
    expect(first).toHaveTextContent("Open");
    expect(screen.getByRole("link", { name: "Invoice query" }).closest("li")).toHaveTextContent("Resolved");
    expect(screen.getByRole("link", { name: "Invoice query" })).toHaveAttribute("href", "/support/tickets/T2");
    expect(screen.getByRole("link", { name: "New message" })).toHaveAttribute("href", "/support");
  });

  it("pages and handles the empty and error cases", async () => {
    searchParams.set("page", "2");
    api.fetchTickets.mockResolvedValue(paged([ticket()], { page: 2, lastPage: 2, total: 21 }));
    const first = renderWithClient(<TicketsList />);
    await screen.findByRole("link", { name: "Where is my parcel?" });
    expect(api.fetchTickets).toHaveBeenCalledWith(2, expect.anything());
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/account/support");
    first.unmount();

    api.fetchTickets.mockResolvedValue(paged([]));
    const second = renderWithClient(<TicketsList />);
    expect(await screen.findByText("You haven't contacted support yet.")).toBeInTheDocument();
    second.unmount();

    api.fetchTickets.mockRejectedValue(new ApiError(500, "server_error", "x"));
    renderWithClient(<TicketsList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load your conversations");
  });
});
