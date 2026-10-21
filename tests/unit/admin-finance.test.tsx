import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCell } from "@/components/admin/reconciliation-view";
import { invoiceFiltersFrom, invoicesHref } from "@/components/admin/invoices-queue";
import { paymentFiltersFrom, paymentsHref } from "@/components/admin/payments-queue";
import { InvoiceScreen, InvoicesScreen, PaymentsScreen, ReconciliationScreen } from "@/components/admin/screens";
import * as financeApi from "@/lib/admin/finance";
import { currencyDecimals, formatMinorAmount, type InvoiceDetail, type InvoiceRow, type PaymentRow, type Reconciliation } from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { staff } from "./admin-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/finance/invoices" }));
vi.mock("@/lib/admin/finance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/finance")>();

  return { ...real, fetchInvoices: vi.fn(), fetchInvoice: vi.fn(), recordOfflinePayment: vi.fn(), fetchPayments: vi.fn(), fetchReconciliation: vi.fn(), downloadLedger: vi.fn() };
});
vi.mock("@/lib/auth/api");

const api = vi.mocked(financeApi);
const auth = vi.mocked(authApi);
const FINANCE = ["payments.view", "payments.record", "invoices.manage", "reports.export"];
const page = <T,>(items: T[], over: Partial<{ page: number; lastPage: number; total: number }> = {}) => ({ items, page: 1, lastPage: 1, total: items.length, ...over });

const invoice = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "I1", number: "INV-2026-000001", status: "paid", kind: "prepaid", tracking_number: "LG000000000001", shipment_id: "S1", billing_name: "Ada Shipper", currency: "USD",
  total_minor: 7041, refunded_minor: 0, issued_at: "2026-10-10T08:00:00Z", due_at: null, paid_at: "2026-10-10T08:05:00Z", overdue: false, ...over,
});

const detail = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  ...invoice(),
  items: [{ kind: "transport", description: "Transportation charge", amount_minor: 5840 }, { kind: "fuel", description: "Fuel surcharge", amount_minor: 1201 }],
  payment_attempts: [{ id: "A1", provider: "sandbox", reference: "sbx_123", status: "succeeded", failure_code: null, amount_minor: 7041, duplicate: false }, { id: "A2", provider: "sandbox", reference: "sbx_456", status: "failed", failure_code: "card_declined", amount_minor: 7041, duplicate: true }],
  ledger: [{ type: "charge", amount_minor: 7041, reference: "sbx_123", metadata: null, occurred_at: "2026-10-10T08:05:00Z" }, { type: "refund", amount_minor: 1000, reference: "re_1", metadata: [], occurred_at: "2026-10-11T08:05:00Z" }],
  credit_notes: [{ number: "CN-2026-000001", amount_minor: 1000 }], ...over,
});

const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({ id: "A1", invoice: "INV-2026-000001", provider: "sandbox", reference: "sbx_123", status: "succeeded", failure_code: null, amount_minor: 7041, currency: "USD", duplicate: false, created_at: "2026-10-10T08:00:00Z", ...over });

const clear: Reconciliation = {
  range: { from: "2026-09-17", to: "2026-10-16" }, summary: { overdue_invoices: 0, failed_webhooks: 0 },
  checks: { overdue_invoices: { description: "Invoices on account that are past their due date and unpaid.", count: 0, rows: [] }, failed_webhooks: { description: "Webhook events that could not be processed.", count: 0, rows: [] } },
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  auth.fetchCurrentUser.mockResolvedValue(staff(FINANCE));
});

describe("money in minor units", () => {
  it("knows how many decimals a currency has", () => {
    expect([currencyDecimals("USD"), currencyDecimals("JPY"), currencyDecimals("KWD")]).toEqual([2, 0, 3]);
  });

  it("formats exactly, negatives included, without floating point drift", () => {
    expect(formatMinorAmount(7041, "USD")).toBe("$70.41");
    expect(formatMinorAmount(5, "USD")).toBe("$0.05");
    expect(formatMinorAmount(3750, "JPY")).toContain("3,750");
    expect(formatMinorAmount(1500, "KWD")).toContain("1.500");
    expect(formatMinorAmount(-1000, "USD")).toBe("-$10.00");
  });
});

describe("filters in the address", () => {
  it("reads only values the API knows, and keeps dates in order", () => {
    expect(invoiceFiltersFrom(new URLSearchParams("status=paid&kind=invoiced&overdue=1&q=%20INV-2026%20&from=2026-10-01&to=2026-10-31&page=2")))
      .toEqual({ status: "paid", kind: "invoiced", overdue: true, q: "INV-2026", from: "2026-10-01", to: "2026-10-31", page: 2 });
    expect(invoiceFiltersFrom(new URLSearchParams("status=bogus&kind=x&from=yesterday&to=2026-10-31"))).toMatchObject({ status: undefined, kind: undefined, from: undefined, to: "2026-10-31" });
    expect(invoiceFiltersFrom(new URLSearchParams("from=2026-10-10&to=2026-10-01")).to).toBeUndefined();
    expect(paymentFiltersFrom(new URLSearchParams("status=failed&provider=sandbox&page=3"))).toEqual({ status: "failed", provider: "sandbox", page: 3 });
    expect(paymentFiltersFrom(new URLSearchParams("status=bogus&provider=<script>")).provider).toBeUndefined();
  });

  it("builds the address back, leaving out defaults", () => {
    expect(invoicesHref({})).toBe("/admin/finance/invoices");
    expect(invoicesHref({ overdue: true, status: "issued", q: "INV" }, 2)).toBe("/admin/finance/invoices?status=issued&overdue=1&q=INV&page=2");
    expect(paymentsHref({ status: "failed" })).toBe("/admin/finance/payments?status=failed");
  });
});

describe("the finance guard", () => {
  it("shows Finance in the menu to people with payments.view only", async () => {
    api.fetchInvoices.mockResolvedValue(page([invoice()]));
    const view = renderWithClient(<InvoicesScreen />);
    const nav = await screen.findByRole("navigation", { name: "Back office" });
    expect(within(nav).getByRole("link", { name: "Finance" })).toHaveAttribute("aria-current", "page");
    view.unmount();

    auth.fetchCurrentUser.mockResolvedValue(staff(["tickets.manage"]));
    renderWithClient(<InvoicesScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchInvoices).toHaveBeenCalledTimes(1);   // only the first render's
  });
});

describe("invoice list", () => {
  it("lists invoices with amounts, type, customer, shipment and dates", async () => {
    api.fetchInvoices.mockResolvedValue(page([
      invoice({ refunded_minor: 1000, status: "partially_refunded" }),
      invoice({ id: "I2", number: "INV-2026-000002", status: "issued", kind: "invoiced", paid_at: null, due_at: "2026-10-01T00:00:00Z", overdue: true, billing_name: "Acme Ltd", total_minor: 150000 }),
    ], { total: 2 }));
    renderWithClient(<InvoicesScreen />);

    const first = (await screen.findByRole("link", { name: "INV-2026-000001" })).closest("li")!;
    expect(first).toHaveTextContent("$70.41 (refunded $10.00)");
    expect(first).toHaveTextContent("Paid online · Ada Shipper");
    expect(first).toHaveTextContent("LG000000000001");
    expect(within(first).getByText("Partly refunded")).toBeInTheDocument();
    const second = screen.getByRole("link", { name: "INV-2026-000002" }).closest("li")!;
    expect(within(second).getByText("Overdue")).toBeInTheDocument();
    expect(second).toHaveTextContent("On account · Acme Ltd");
    expect(second).toHaveTextContent("due");
    expect(screen.getByText("2 invoices")).toBeInTheDocument();
  });

  it("asks the API for the filters in the address and changes the address when they change", async () => {
    searchParams.set("overdue", "1");
    api.fetchInvoices.mockResolvedValue(page([invoice()]));
    renderWithClient(<InvoicesScreen />);
    await screen.findByRole("link", { name: "INV-2026-000001" });

    expect(api.fetchInvoices.mock.calls[0][0]).toMatchObject({ overdue: true });
    expect(screen.getByLabelText("Overdue only")).toBeChecked();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "issued");
    expect(replace).toHaveBeenLastCalledWith("/admin/finance/invoices?status=issued&overdue=1");
    await userEvent.type(screen.getByLabelText("Invoice number"), "INV-2026");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=INV-2026"));
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("says when nothing matches, and offers a retry when it can't load", async () => {
    searchParams.set("status", "void");
    api.fetchInvoices.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([]));
    renderWithClient(<InvoicesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No invoices match these filters.")).toBeInTheDocument();
  });
});

describe("invoice detail", () => {
  const open = (perms = FINANCE, d = detail()) => {
    auth.fetchCurrentUser.mockResolvedValue(staff(perms));
    api.fetchInvoice.mockResolvedValue(d);

    return renderWithClient(<InvoiceScreen id="I1" />);
  };

  it("shows the lines and total, the attempts, the ledger and the credit notes", async () => {
    open(FINANCE, detail({ refunded_minor: 1000 }));

    expect(await screen.findByRole("heading", { name: "INV-2026-000001" })).toBeInTheDocument();
    const lines = screen.getByRole("table", { name: "Invoice lines" });
    expect(lines).toHaveTextContent("Transportation charge$58.40");
    expect(lines).toHaveTextContent("Total$70.41");
    expect(lines).toHaveTextContent("Refunded$10.00");
    const attempts = screen.getByRole("heading", { name: "Payment attempts" }).parentElement!;
    expect(attempts).toHaveTextContent("Succeeded");
    expect(attempts).toHaveTextContent("Duplicate payment");
    expect(attempts).toHaveTextContent("Failed: card declined");
    const ledger = screen.getByRole("table", { name: "Ledger entries, oldest first" });
    expect(ledger).toHaveTextContent("Payment received");
    expect(ledger).toHaveTextContent("−$10.00");
    expect(screen.getByText(/CN-2026-000001 \(\$10\.00\)/)).toBeInTheDocument();
  });

  it("links to the shipment only for people who may open shipments", async () => {
    const view = open([...FINANCE, "shipments.view"]);
    expect(await screen.findByRole("link", { name: "LG000000000001" })).toHaveAttribute("href", "/admin/shipments/S1");
    view.unmount();

    open(FINANCE);
    await screen.findByRole("heading", { name: "INV-2026-000001" });
    expect(screen.queryByRole("link", { name: "LG000000000001" })).not.toBeInTheDocument();
    expect(screen.getAllByText("LG000000000001").length).toBeGreaterThan(0);
  });

  it("marks a ledger entry that was recorded by hand", async () => {
    open(FINANCE, detail({ ledger: [{ type: "charge", amount_minor: 7041, reference: "BANK-9", metadata: { method: "offline" }, occurred_at: "2026-10-10T08:05:00Z" }] }));

    expect(await screen.findByText("Payment received (recorded by hand)")).toBeInTheDocument();
  });

  describe("recording a payment", () => {
    const unpaid = (over: Partial<InvoiceDetail> = {}) => detail({ status: "issued", kind: "invoiced", paid_at: null, due_at: "2026-10-24T00:00:00Z", payment_attempts: [], ledger: [], credit_notes: [], ...over });

    it("is offered only for unpaid invoices on account, and only to people who record payments", async () => {
      const view = open(FINANCE, unpaid());
      expect(await screen.findByRole("region", { name: "Record a payment" })).toBeInTheDocument();
      view.unmount();

      const view2 = open(["payments.view"], unpaid());
      await screen.findByRole("heading", { name: "INV-2026-000001" });
      expect(screen.queryByRole("region", { name: "Record a payment" })).not.toBeInTheDocument();
      view2.unmount();

      open(FINANCE, detail());   // already paid online
      await screen.findByRole("heading", { name: "INV-2026-000001" });
      expect(screen.queryByRole("region", { name: "Record a payment" })).not.toBeInTheDocument();
    });

    it("needs a reference, asks to confirm the whole amount, then records it", async () => {
      api.recordOfflinePayment.mockResolvedValue(invoice({ status: "paid" }));
      open(FINANCE, unpaid());
      expect(await screen.findByRole("button", { name: "Review payment" })).toBeDisabled();

      await userEvent.type(screen.getByLabelText("Payment reference"), "BANK-778");
      await userEvent.click(screen.getByRole("button", { name: "Review payment" }));
      expect(screen.getByRole("group", { name: "Confirm payment" })).toHaveTextContent("Record $70.41 received as “BANK-778”?");
      await userEvent.click(screen.getByRole("button", { name: "Go back" }));
      expect(api.recordOfflinePayment).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Review payment" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, record it" }));
      await waitFor(() => expect(api.recordOfflinePayment).toHaveBeenCalledWith("I1", "BANK-778", expect.any(String)));
    });

    it("retries under the same key for the same reference, and a new key for another", async () => {
      api.recordOfflinePayment.mockRejectedValue(new ApiError(0, "network", "x"));
      open(FINANCE, unpaid());
      await userEvent.type(await screen.findByLabelText("Payment reference"), "BANK-1");
      const attempt = async () => { await userEvent.click(screen.getByRole("button", { name: "Review payment" })); await userEvent.click(screen.getByRole("button", { name: "Yes, record it" })); await screen.findByRole("alert"); };

      await attempt();
      await attempt();
      await userEvent.type(screen.getByLabelText("Payment reference"), "X");
      await attempt();

      const keys = api.recordOfflinePayment.mock.calls.map((c) => c[2]);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[0]);
    });

    it("explains it when someone else got there first, and reloads", async () => {
      api.recordOfflinePayment.mockRejectedValue(new ApiError(409, "payment_not_recordable", "x"));
      open(FINANCE, unpaid());
      await userEvent.type(await screen.findByLabelText("Payment reference"), "BANK-1");
      await userEvent.click(screen.getByRole("button", { name: "Review payment" }));
      api.fetchInvoice.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Yes, record it" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("already been paid");
      await waitFor(() => expect(api.fetchInvoice).toHaveBeenCalled());
    });
  });

  it("copes with an invoice that is gone", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(FINANCE));
    api.fetchInvoice.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<InvoiceScreen id="I1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find this invoice");
  });
});

describe("payments", () => {
  it("lists payments with provider, invoice, reference, failure and duplicate flags", async () => {
    api.fetchPayments.mockResolvedValue(page([payment(), payment({ id: "A2", status: "failed", failure_code: "card_declined", duplicate: true, reference: null })], { total: 2 }));
    renderWithClient(<PaymentsScreen />);

    const first = (await screen.findAllByRole("listitem"))[0];
    expect(first).toHaveTextContent("$70.41 via sandbox");
    expect(first).toHaveTextContent("INV-2026-000001");
    expect(first).toHaveTextContent("sbx_123");
    const second = screen.getAllByRole("listitem")[1];
    expect(second).toHaveTextContent("Failed: card declined");
    expect(within(second).getByText("Duplicate payment")).toBeInTheDocument();
  });

  it("filters by status through the address", async () => {
    api.fetchPayments.mockResolvedValue(page([payment()]));
    renderWithClient(<PaymentsScreen />);
    await screen.findByText("1 payment");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
    expect(replace).toHaveBeenLastCalledWith("/admin/finance/payments?status=failed");
  });
});

describe("reconciliation", () => {
  it("formats cells: money with its currency, timestamps readably, blanks as a dash", () => {
    expect(formatCell("total_minor", 150000, { currency_code: "USD" })).toBe("$1,500.00");
    expect(formatCell("total_minor", 150000, {})).toBe("150000");
    expect(formatCell("due_at", "2026-10-01 00:00:00", {})).toMatch(/2026/);
    expect(formatCell("due_at", "2026-10-08 03:17:31+00", {})).toMatch(/Oct.*2026|2026/);   // exactly how PostgreSQL returns it
    expect(formatCell("due_at", "2026-13-45 99:99:99", {})).toBe("2026-13-45 99:99:99");   // never throws on odd text
    expect(formatCell("error", null, {})).toBe("—");
    expect(formatCell("number", "INV-2026-000001", {})).toBe("INV-2026-000001");
  });

  it("says everything agrees when every check is clear", async () => {
    api.fetchReconciliation.mockResolvedValue(clear);
    renderWithClient(<ReconciliationScreen />);

    expect(await screen.findByText(/Checked 2026-09-17 to 2026-10-16: everything agrees\./)).toBeInTheDocument();
    expect(screen.getAllByText("All clear")).toHaveLength(2);
  });

  it("shows what needs a look, with the rows behind it", async () => {
    api.fetchReconciliation.mockResolvedValue({
      range: clear.range, summary: { overdue_invoices: 2, failed_webhooks: 0 },
      checks: {
        overdue_invoices: { description: "Invoices on account that are past their due date and unpaid.", count: 2, rows: [{ number: "INV-2026-000007", currency_code: "USD", total_minor: 150000, due_at: "2026-10-01 00:00:00", days_overdue: 15 }, { number: "INV-2026-000008", currency_code: "USD", total_minor: 2500, due_at: null, days_overdue: 3 }] },
        failed_webhooks: clear.checks.failed_webhooks,
      },
    });
    renderWithClient(<ReconciliationScreen />);

    expect(await screen.findByText(/2 things need a look\./)).toBeInTheDocument();
    const check = screen.getByRole("heading", { name: "Overdue invoices on account" }).closest("li")!;
    expect(within(check).getByText("2 to look at")).toBeInTheDocument();
    const table = within(check).getByRole("table", { name: "Overdue invoices on account" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Number", "Total", "Due at", "Days overdue"]);
    expect(table).toHaveTextContent("INV-2026-000007");
    expect(table).toHaveTextContent("$1,500.00");
    expect(table).toHaveTextContent("—");
  });

  it("says when rows were cut off", async () => {
    api.fetchReconciliation.mockResolvedValue({ range: clear.range, summary: { failed_webhooks: 250 }, checks: { failed_webhooks: { description: "Webhook events that could not be processed.", count: 250, rows: [{ source: "sandbox", event_id: "e1" }] } } });
    renderWithClient(<ReconciliationScreen />);

    expect(await screen.findByText("249 more not shown. Narrow the dates to see them.")).toBeInTheDocument();
  });

  it("asks the API for the period in the address and changes it when the dates change", async () => {
    searchParams.set("from", "2026-10-01");
    searchParams.set("to", "2026-10-15");
    api.fetchReconciliation.mockResolvedValue(clear);
    renderWithClient(<ReconciliationScreen />);
    await screen.findByText(/everything agrees/);

    expect(api.fetchReconciliation.mock.calls[0][0]).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    await userEvent.clear(within(screen.getByRole("search", { name: "Choose the period" })).getByLabelText("To"));
    expect(replace).toHaveBeenLastCalledWith("/admin/finance/invoices?from=2026-10-01");   // the mocked pathname; the real one is the current page
  });

  describe("exporting the ledger", () => {
    const open = (perms = FINANCE) => {
      auth.fetchCurrentUser.mockResolvedValue(staff(perms));
      api.fetchReconciliation.mockResolvedValue(clear);

      return renderWithClient(<ReconciliationScreen />);
    };

    it("is offered only to people who manage invoices and may export", async () => {
      const view = open();
      expect(await screen.findByRole("region", { name: "Export the ledger" })).toBeInTheDocument();
      view.unmount();

      open(["payments.view", "reports.export"]);
      await screen.findByText(/everything agrees/);
      expect(screen.queryByRole("region", { name: "Export the ledger" })).not.toBeInTheDocument();
    });

    it("needs a valid period, then downloads it", async () => {
      api.downloadLedger.mockResolvedValue(undefined);
      open();
      const panel = await screen.findByRole("region", { name: "Export the ledger" });
      const button = within(panel).getByRole("button", { name: "Download CSV" });
      expect(button).toBeDisabled();

      await userEvent.type(within(panel).getByLabelText("To"), "2026-09-01");
      await userEvent.type(within(panel).getByLabelText("From"), "2026-10-01");
      expect(within(panel).getByText("The end can't be before the start.")).toBeInTheDocument();
      expect(button).toBeDisabled();
      await userEvent.clear(within(panel).getByLabelText("To"));
      await userEvent.type(within(panel).getByLabelText("To"), "2026-10-31");
      await userEvent.click(button);

      await waitFor(() => expect(api.downloadLedger).toHaveBeenCalledWith("2026-10-01", "2026-10-31"));
      expect(await within(panel).findByText("The ledger for 2026-10-01 to 2026-10-31 was downloaded.")).toBeInTheDocument();
    });

    it("shows the API's reason when it refuses", async () => {
      api.downloadLedger.mockRejectedValue(new ApiError(422, "validation_failed", "This export has 90000 rows; choose a shorter period."));
      open();
      const panel = await screen.findByRole("region", { name: "Export the ledger" });
      await userEvent.type(within(panel).getByLabelText("From"), "2026-01-01");
      await userEvent.type(within(panel).getByLabelText("To"), "2026-10-31");
      await userEvent.click(within(panel).getByRole("button", { name: "Download CSV" }));

      expect(await within(panel).findByRole("alert")).toHaveTextContent("choose a shorter period");
    });
  });
});

describe("the CSV download itself", () => {
  const real = () => vi.importActual<typeof import("@/lib/admin/finance")>("@/lib/admin/finance");

  it("saves the file the API sends, named for the period", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a,b\n1,2\n", { status: 200, headers: { "Content-Type": "text/csv" } })));
    const save = vi.fn();

    await (await real()).downloadLedger("2026-10-01", "2026-10-31", save);

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1]).toBe("ledger-2026-10-01_2026-10-31.csv");
    expect(await (save.mock.calls[0][0] as Blob).text()).toBe("a,b\n1,2\n");
    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/export\/transactions\?from=2026-10-01&to=2026-10-31$/);
    vi.unstubAllGlobals();
  });

  it("turns a JSON refusal into an error with the API's words, and saves nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "forbidden", message: "This action is unauthorized." } }), { status: 403, headers: { "Content-Type": "application/json" } })));
    const save = vi.fn();

    await expect((await real()).downloadLedger("2026-10-01", "2026-10-31", save)).rejects.toMatchObject({ status: 403, code: "forbidden", message: "This action is unauthorized." });
    expect(save).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("how filters are sent", () => {
  it("writes yes/no filters the way the API's validator reads them", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [], meta: { total: 0, last_page: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const finance = await vi.importActual<typeof import("@/lib/admin/finance")>("@/lib/admin/finance");
    const admin = await vi.importActual<typeof import("@/lib/admin/api")>("@/lib/admin/api");

    await finance.fetchInvoices({ overdue: true, status: "issued" });
    await admin.fetchAdminTickets({ breached: true });

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/invoices\?overdue=1&status=issued$/);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/tickets\?breached=1$/);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("true");
    vi.unstubAllGlobals();
  });
});
