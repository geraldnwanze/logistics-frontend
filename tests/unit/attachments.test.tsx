import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimDetail } from "@/components/claims/claim-detail";
import { ClaimForm } from "@/components/claims/claim-form";
import { AttachmentLinks, AttachmentPicker, addFiles, MAX_FILES } from "@/components/support/attachment-picker";
import { NewTicketForm } from "@/components/support/new-ticket-form";
import { TicketThread } from "@/components/support/ticket-thread";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import * as download from "@/lib/shipping/download";
import * as supportApi from "@/lib/support/api";
import { claimSchema, ticketSchema } from "@/lib/support/schemas";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { limits, claim, ticket } from "./support-fixtures";
import { shipment } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/support/api");
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/shipping/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shipping/download")>()), openSignedLink: vi.fn() }));

const api = vi.mocked(supportApi);

const file = (name: string, type = "application/pdf", size = 2048, modified = 1) => {
  const f = new File(["x".repeat(Math.min(size, 16))], name, { type, lastModified: modified });
  Object.defineProperty(f, "size", { value: size });

  return f;
};
const photo = (name = "box.jpg") => file(name, "image/jpeg", 150_000);
const upload = (files: File[]) => userEvent.upload(screen.getByTestId("attachment-input"), files, { applyAccept: false });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:preview-${++n}`), revokeObjectURL: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("addFiles", () => {
  it("adds acceptable files in the order chosen", () => {
    const { files, problems } = addFiles([], [file("a.pdf"), photo("b.jpg"), file("c.png", "image/png")]);

    expect(files.map((f) => f.name)).toEqual(["a.pdf", "b.jpg", "c.png"]);
    expect(problems).toEqual([]);
  });

  it("names each refused file and the reason, and still adds the good ones", () => {
    const { files, problems } = addFiles([], [file("good.pdf"), file("setup.exe", "application/octet-stream"), file("empty.pdf", "application/pdf", 0), file("huge.pdf", "application/pdf", 11 * 1024 * 1024)]);

    expect(files.map((f) => f.name)).toEqual(["good.pdf"]);
    expect(problems).toEqual(["“setup.exe”: Only PDF, JPEG and PNG files are accepted.", "“empty.pdf”: This file is empty.", expect.stringContaining("“huge.pdf”: This file is larger than 10 MB")]);
  });

  it("ignores the same file chosen twice, but not a different file with the same name", () => {
    const first = file("a.pdf", "application/pdf", 100, 1);
    const { files } = addFiles([first], [file("a.pdf", "application/pdf", 100, 1), file("a.pdf", "application/pdf", 100, 2)]);

    expect(files).toHaveLength(2);
  });

  it(`stops at ${MAX_FILES} files and says which ones were left out`, () => {
    const chosen = Array.from({ length: 7 }, (_, i) => file(`f${i}.pdf`, "application/pdf", 100, i));
    const { files, problems } = addFiles([], chosen);

    expect(files).toHaveLength(MAX_FILES);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("“f5.pdf” wasn't added");
  });
});

describe("AttachmentPicker", () => {
  function Harness({ initial = [] as File[], disabled = false }) {
    const [files, setFiles] = useState<File[]>(initial);

    return <AttachmentPicker files={files} onChange={setFiles} disabled={disabled} hint="Photos help." />;
  }

  it("tells people what is accepted and shows the hint", () => {
    renderWithClient(<Harness />);

    expect(screen.getByText("Photos help.")).toBeInTheDocument();
    expect(screen.getByText(/PDF, JPEG or PNG, up to 10 MB each, at most 5/)).toBeInTheDocument();
    expect(screen.getByTestId("attachment-input")).toHaveAttribute("accept", expect.stringContaining("image/jpeg"));
    expect(screen.getByTestId("attachment-input")).toHaveAttribute("multiple");
  });

  it("lists chosen files with sizes, previews photos, and removes one on request", async () => {
    renderWithClient(<Harness />);

    await upload([photo("box.jpg"), file("receipt.pdf", "application/pdf", 3 * 1024 * 1024)]);

    const list = screen.getByRole("list", { name: "Files to send" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("box.jpg");
    expect(first).toHaveTextContent("146 KB");
    expect(first.querySelector("img")).toHaveAttribute("src", "blob:preview-1");
    expect(second).toHaveTextContent("receipt.pdf");
    expect(second).toHaveTextContent("3.0 MB");
    expect(second.querySelector("img")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Remove box.jpg" }));
    expect(within(screen.getByRole("list", { name: "Files to send" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("explains refused files without losing the accepted ones", async () => {
    renderWithClient(<Harness />);

    await upload([file("ok.pdf"), file("virus.exe", "application/octet-stream")]);

    expect(screen.getByRole("alert")).toHaveTextContent("“virus.exe”: Only PDF, JPEG and PNG files are accepted.");
    expect(screen.getByText("ok.pdf")).toBeInTheDocument();
  });

  it("stops offering to add more once the limit is reached", async () => {
    renderWithClient(<Harness initial={Array.from({ length: MAX_FILES }, (_, i) => file(`f${i}.pdf`, "application/pdf", 100, i))} />);

    expect(screen.getByRole("button", { name: "Add photos or documents" })).toBeDisabled();
  });

  it("is inert while a form is being sent", () => {
    renderWithClient(<Harness initial={[file("a.pdf")]} disabled />);

    expect(screen.getByRole("button", { name: "Remove a.pdf" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add photos or documents" })).toBeDisabled();
  });

  it("lets go of preview memory when files are removed or the form goes away", async () => {
    const view = renderWithClient(<Harness />);
    await upload([photo()]);

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });
});

describe("AttachmentLinks", () => {
  const items = [{ id: "A1", name: "damage.jpg", size: 150_000, type: "image/jpeg" }, { id: "A2", name: "receipt.pdf", size: 2048, type: "application/pdf" }];

  it("shows nothing when there are no files", () => {
    const { container } = renderWithClient(<AttachmentLinks attachments={[]} load={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lists the files with their kind and size, and opens one through a fresh link", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    const load = vi.fn().mockResolvedValue({ url: "x" });
    renderWithClient(<AttachmentLinks attachments={items} load={load} />);

    const button = screen.getByRole("button", { name: "Download damage.jpg" });
    expect(button).toHaveTextContent("Photo");
    expect(button).toHaveTextContent("(146 KB)");
    expect(screen.getByRole("button", { name: "Download receipt.pdf" })).toHaveTextContent("PDF");

    await userEvent.click(button);
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();
    expect(load).toHaveBeenCalledWith("A1");
  });

  it("shows why a download failed", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue("We couldn't find that document.");
    renderWithClient(<AttachmentLinks attachments={items} load={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Download receipt.pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find that document");
  });

  it("renders file names as text", () => {
    renderWithClient(<AttachmentLinks attachments={[{ id: "A1", name: "<img src=x onerror=alert(1)>.pdf", size: 10, type: "application/pdf" }]} load={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Download <img src=x onerror=alert(1)>.pdf" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("multipart calls", () => {
  const real = () => vi.importActual<typeof import("@/lib/support/api")>("@/lib/support/api");
  const ok = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    document.cookie = "XSRF-TOKEN=t; path=/";
    sessionStorage.setItem("ticket-token:T1", "tok");
  });

  it("sends plain JSON when there are no files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: ticket() }));
    vi.stubGlobal("fetch", fetchMock);

    await (await real()).openTicket({ subject: "S", category: "general", message: "M", email: "a@b.test" });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ subject: "S", category: "general", message: "M", email: "a@b.test" });
  });

  it("sends the same fields plus every file as attachments[] when there are files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: ticket() }));
    vi.stubGlobal("fetch", fetchMock);

    await (await real()).openTicket({ subject: "S", category: "general", message: "M", email: "a@b.test" }, undefined, [file("a.pdf"), photo("b.jpg")]);

    const init = fetchMock.mock.calls[0][1];
    const form = init.body as FormData;
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(form.get("subject")).toBe("S");
    expect(form.get("email")).toBe("a@b.test");
    expect(form.getAll("attachments[]").map((f) => (f as File).name)).toEqual(["a.pdf", "b.jpg"]);
  });

  it("leaves out fields that were not given instead of sending the word 'undefined'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: ticket() }));
    vi.stubGlobal("fetch", fetchMock);

    await (await real()).openTicket({ subject: "S", category: "general", message: "M" }, undefined, [file("a.pdf")]);

    expect([...(fetchMock.mock.calls[0][1].body as FormData).keys()]).toEqual(["subject", "category", "message", "attachments[]"]);
  });

  it("uses the ticket token for replies with files, and fetches attachment links the same way", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ data: ticket() })).mockResolvedValueOnce(ok({ data: { url: "http://localhost:8000/x" } }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await real();

    await mod.replyToTicket("T1", "Photo attached", [photo()]);
    await mod.fetchTicketAttachmentLink("T1", "A1");

    expect(fetchMock.mock.calls[0][1].headers["X-Ticket-Token"]).toBe("tok");
    expect((fetchMock.mock.calls[0][1].body as FormData).get("message")).toBe("Photo attached");
    expect(fetchMock.mock.calls[1][0]).toMatch(/support\/tickets\/T1\/attachments\/A1$/);
    expect(fetchMock.mock.calls[1][1].headers["X-Ticket-Token"]).toBe("tok");
  });

  it("files claims and claim messages with evidence, authorised by the shipment's token", async () => {
    sessionStorage.setItem("guest-token:S1", "guest");
    sessionStorage.setItem("claim-shipment:C1", "S1");
    const fetchMock = vi.fn().mockImplementation(async () => ok({ data: claim() }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await real();

    await mod.fileClaim("S1", { type: "damage", claimed_amount: "20.00", description: "Crushed in transit.", incident_date: "2026-10-15" }, [photo()]);
    await mod.addClaimNote("C1", "More evidence", [file("receipt.pdf")]);

    expect((fetchMock.mock.calls[0][1].body as FormData).get("claimed_amount")).toBe("20.00");
    expect((fetchMock.mock.calls[0][1].body as FormData).getAll("attachments[]")).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1].headers["X-Guest-Token"]).toBe("guest");
    expect(fetchMock.mock.calls[1][1].headers["X-Guest-Token"]).toBe("guest");
    expect((fetchMock.mock.calls[1][1].body as FormData).get("body")).toBe("More evidence");
  });
});

describe("schemas", () => {
  it("accept replies from an API that predates attachments", () => {
    const { attachments, ...older } = claim();   // eslint-disable-line @typescript-eslint/no-unused-vars
    const oldTicket = { ...ticket(), messages: [{ from: "customer", body: "Hi", created_at: "2026-10-16T09:00:00Z" }] };

    expect(claimSchema.parse(older).attachments).toEqual([]);
    expect(ticketSchema.parse(oldTicket).messages[0].attachments).toEqual([]);
  });
});

describe("new ticket with files", () => {
  const fillGuest = async () => {
    await userEvent.type(screen.getByLabelText("Subject"), "Damaged parcel");
    await userEvent.type(screen.getByLabelText("How can we help?"), "Photos attached.");
    await userEvent.type(screen.getByLabelText("Your email"), "guest@example.test");
  };

  it("sends the chosen files and clears them once it works", async () => {
    api.openTicket.mockResolvedValue(ticket());
    renderWithClient(<NewTicketForm />);
    await fillGuest();
    const chosen = [photo(), file("receipt.pdf")];
    await upload(chosen);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(api.openTicket).toHaveBeenCalled());
    expect(api.openTicket.mock.calls[0][2]).toEqual(chosen);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Files to send" })).not.toBeInTheDocument());
  });

  it("shows the server's own words when it refuses a file, and keeps the files so they can be swapped", async () => {
    api.openTicket.mockRejectedValue(new ApiError(422, "unsupported_attachment", "“evidence.pdf” isn't a PDF, JPEG or PNG file."));
    renderWithClient(<NewTicketForm />);
    await fillGuest();
    await upload([file("evidence.pdf")]);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("“evidence.pdf” isn't a PDF, JPEG or PNG file.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Files to send" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ticket thread with files", () => {
  it("shows files under the message they came with, and opens them through the ticket's link", async () => {
    api.fetchTicket.mockResolvedValue(ticket({ messages: [{ from: "customer", body: "See photo", created_at: "2026-10-16T09:00:00Z", attachments: [{ id: "A1", name: "damage.jpg", size: 1000, type: "image/jpeg" }] }, { from: "staff", body: "Thanks", created_at: "2026-10-16T10:00:00Z", attachments: [] }] }));
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    renderWithClient(<TicketThread id="T1" />);

    const first = (await screen.findByText("See photo")).closest("li")!;
    await userEvent.click(within(first).getByRole("button", { name: "Download damage.jpg" }));
    api.fetchTicketAttachmentLink.mockResolvedValue({ url: "x" });
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();

    expect(api.fetchTicketAttachmentLink).toHaveBeenCalledWith("T1", "A1");
    expect(within(screen.getByText("Thanks").closest("li")!).queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("sends a reply with files and clears them", async () => {
    api.fetchTicket.mockResolvedValue(ticket());
    api.replyToTicket.mockResolvedValue(ticket());
    renderWithClient(<TicketThread id="T1" />);
    await userEvent.type(await screen.findByLabelText("Your reply"), "Here it is");
    const chosen = [photo()];
    await upload(chosen);

    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(api.replyToTicket).toHaveBeenCalledWith("T1", "Here it is", chosen));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Files to send" })).not.toBeInTheDocument());
  });

  it("explains the attachment limit the server enforces", async () => {
    api.fetchTicket.mockResolvedValue(ticket());
    api.replyToTicket.mockRejectedValue(new ApiError(422, "too_many_attachments", "This ticket already has 18 attachments; the limit is 20."));
    renderWithClient(<TicketThread id="T1" />);
    await userEvent.type(await screen.findByLabelText("Your reply"), "More");
    await upload([photo()]);

    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already has 18 attachments");
  });
});

describe("claims with files", () => {
  beforeEach(() => {
    api.fetchClaimLimits.mockResolvedValue(limits());
    vi.mocked(shippingApi.fetchShipment).mockResolvedValue(shipment({ status: "delivered", status_label: "Delivered", created_at: "2026-10-10T08:00:00Z" }));
  });

  it("asks for evidence, sends it with the claim, and clears it", async () => {
    api.fileClaim.mockResolvedValue(claim());
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await userEvent.type(await screen.findByLabelText(/Amount you are claiming/), "20");
    await userEvent.type(screen.getByLabelText("What happened?"), "The box arrived crushed and the items broke.");
    expect(screen.getByText(/Photos of the damage, the packaging and the shipping label/)).toBeInTheDocument();
    const chosen = [photo("crushed.jpg"), file("receipt.pdf")];
    await upload(chosen);

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    await waitFor(() => expect(api.fileClaim).toHaveBeenCalled());
    expect(api.fileClaim.mock.calls[0][2]).toEqual(chosen);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/claims/C1"));
  });

  it("still files a claim with no files at all", async () => {
    api.fileClaim.mockResolvedValue(claim());
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await userEvent.type(await screen.findByLabelText(/Amount you are claiming/), "20");
    await userEvent.type(screen.getByLabelText("What happened?"), "The box arrived crushed and the items broke.");

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    await waitFor(() => expect(api.fileClaim.mock.calls[0][2]).toEqual([]));
  });

  it("shows a refused file in the server's words", async () => {
    api.fileClaim.mockRejectedValue(new ApiError(422, "attachment_too_large", "“big.pdf” is larger than 10 MB."));
    renderWithClient(<ClaimForm shipmentId="S1" />);
    await userEvent.type(await screen.findByLabelText(/Amount you are claiming/), "20");
    await userEvent.type(screen.getByLabelText("What happened?"), "The box arrived crushed and the items broke.");
    await upload([file("big.pdf")]);

    await userEvent.click(screen.getByRole("button", { name: "Submit claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("“big.pdf” is larger than 10 MB.");
  });

  it("shows the evidence sent with a claim and with later messages, and sends more", async () => {
    api.fetchClaim.mockResolvedValue(claim({
      attachments: [{ id: "A1", name: "crushed.jpg", size: 1000, type: "image/jpeg" }],
      notes: [{ from: "staff", body: "Please add the receipt.", created_at: "2026-10-16T10:00:00Z", attachments: [] }, { from: "customer", body: "Receipt attached", created_at: "2026-10-16T11:00:00Z", attachments: [{ id: "A2", name: "receipt.pdf", size: 2000, type: "application/pdf" }] }],
    }));
    api.addClaimNote.mockResolvedValue(claim());
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    renderWithClient(<ClaimDetail id="C1" />);

    const story = (await screen.findByText("What you told us")).closest("section")!;
    expect(within(story).getByRole("button", { name: "Download crushed.jpg" })).toBeInTheDocument();
    const second = screen.getByText("Receipt attached").closest("li")!;
    expect(within(second).getByRole("button", { name: "Download receipt.pdf" })).toBeInTheDocument();

    await userEvent.click(within(story).getByRole("button", { name: "Download crushed.jpg" }));
    api.fetchClaimAttachmentLink.mockResolvedValue({ url: "x" });
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();
    expect(api.fetchClaimAttachmentLink).toHaveBeenCalledWith("C1", "A1");

    await userEvent.type(screen.getByLabelText("Add a message"), "Another photo");
    const more = [photo("more.jpg")];
    await upload(more);
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.addClaimNote).toHaveBeenCalledWith("C1", "Another photo", more));
  });
});
