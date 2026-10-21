import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicesList } from "@/components/account/invoices-list";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import * as download from "@/lib/shipping/download";
import { invoiceLabel } from "@/lib/shipping/format";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { invoice, money, paged } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/shipping/download");

const api = vi.mocked(shippingApi);

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("invoiceLabel", () => {
  const base = invoice();

  it.each([
    [{ status: "paid" }, "Paid", "good"], [{ status: "void" }, "Cancelled", "bad"], [{ status: "issued", kind: "prepaid" }, "Awaiting payment", "warn"],
    [{ status: "issued", kind: "invoiced" }, "Payment due", "warn"], [{ status: "paid", refunded: money(1000) }, "Partly refunded", "warn"],
    [{ status: "paid", refunded: money(7041) }, "Refunded", "plain"], [{ status: "something_new" }, "something new", "plain"],
  ])("labels %j as %s", (change, text, tone) => {
    expect(invoiceLabel({ ...base, ...change })).toEqual({ text, tone });
  });
});

describe("InvoicesList", () => {
  it("lists invoices with number, dates, shipment link, status and total", async () => {
    api.fetchInvoices.mockResolvedValue(paged([invoice()]));
    renderWithClient(<InvoicesList />);

    const row = (await screen.findByText("INV-2026-000001")).closest("li")!;
    expect(row).toHaveTextContent("Paid");
    expect(row).toHaveTextContent("70.41");
    expect(within(row).getByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/shipments/01SHIP000001AAAAAA");
    expect(row).toHaveTextContent(/paid .*2026/);
  });

  it("explains what makes up an invoice, including credit notes after a refund", async () => {
    api.fetchInvoices.mockResolvedValue(paged([invoice({ status: "paid", refunded: money(7041), credit_notes: [{ number: "CN-2026-000001", amount: money(7041), issued_at: "2026-10-17T08:00:00Z" }] })]));
    renderWithClient(<InvoicesList />);

    const row = (await screen.findByText("INV-2026-000001")).closest("li")!;
    expect(within(row).getByText("Refunded", { selector: "span" })).toBeInTheDocument();
    expect(within(row).getByText(/Refunded .*70\.41/)).toBeInTheDocument();
    const table = within(row).getByRole("table", { name: "Lines on invoice INV-2026-000001" });
    expect(within(table).getByRole("rowheader", { name: "Transportation charge" })).toBeInTheDocument();
    expect(within(row).getByText(/Credit note CN-2026-000001/)).toBeInTheDocument();
    expect(within(row).getByText("Billed to Ife Okoro")).toBeInTheDocument();
  });

  it("downloads a receipt for a paid invoice and an invoice for an unpaid one", async () => {
    api.fetchInvoices.mockResolvedValue(paged([invoice(), invoice({ id: "INV2", number: "INV-2", status: "issued", paid_at: null, due_at: "2026-11-01T00:00:00Z" })]));
    vi.mocked(download.downloadInvoice).mockResolvedValue(null);
    renderWithClient(<InvoicesList />);

    const buttons = await screen.findAllByRole("button", { name: /Download/ });
    expect(buttons.map((b) => b.textContent)).toEqual(["Download receipt (PDF)", "Download invoice (PDF)"]);

    await userEvent.click(buttons[1]);
    expect(download.downloadInvoice).toHaveBeenCalledWith("INV2");
  });

  it("tells the customer when a download can't be prepared", async () => {
    api.fetchInvoices.mockResolvedValue(paged([invoice()]));
    vi.mocked(download.downloadInvoice).mockResolvedValue("We couldn't reach the server. Check your connection and try again.");
    renderWithClient(<InvoicesList />);

    await userEvent.click(await screen.findByRole("button", { name: /Download/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
    expect(screen.getByRole("button", { name: /Download/ })).toBeEnabled();
  });

  it("pages through invoices", async () => {
    searchParams.set("page", "2");
    api.fetchInvoices.mockResolvedValue(paged([invoice()], { page: 2, lastPage: 2, total: 21 }));
    renderWithClient(<InvoicesList />);

    await screen.findByText("INV-2026-000001");

    expect(api.fetchInvoices).toHaveBeenCalledWith(2, expect.anything());
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/account/invoices");
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  it("handles an empty list, and an empty later page", async () => {
    api.fetchInvoices.mockResolvedValue(paged([]));
    const first = renderWithClient(<InvoicesList />);
    expect(await screen.findByText("No invoices yet.")).toBeInTheDocument();
    first.unmount();

    searchParams.set("page", "5");
    renderWithClient(<InvoicesList />);
    await userEvent.click(await screen.findByRole("button", { name: "Back to the first page" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account/invoices"));
  });

  it("offers a retry on failure", async () => {
    api.fetchInvoices.mockRejectedValue(new ApiError(500, "server_error", "x"));
    renderWithClient(<InvoicesList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load your invoices");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
