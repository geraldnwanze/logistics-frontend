import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeclarationForm } from "@/components/customs/declaration-form";
import { CustomsScreen, CustomsView } from "@/components/customs/customs-view";
import { ShipmentView } from "@/components/booking/shipment-view";
import { ApiError } from "@/lib/api/client";
import * as shippingApi from "@/lib/shipping/api";
import * as download from "@/lib/shipping/download";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { customs, money, shipment } from "./shipping-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams }));
vi.mock("@/lib/shipping/api");
vi.mock("@/lib/shipping/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/shipping/download")>()), openSignedLink: vi.fn() }));

const api = vi.mocked(shippingApi);
const declared = { incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: null, eori_number: null, remarks: null };
const render = (c = customs(), s = shipment()) => renderWithClient(<CustomsScreen id={s.id} customs={c} shipment={s} />);
const pdf = (name = "licence.pdf", type = "application/pdf") => new File(["%PDF-1.4"], name, { type });

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
});

describe("DeclarationForm", () => {
  it("saves the declaration and shows the saved values", async () => {
    api.saveDeclaration.mockResolvedValue(customs({ declaration: { ...declared, eori_number: "DE123456789" } }));
    renderWithClient(<DeclarationForm shipmentId="S1" declaration={null} readOnly={false} />);

    await userEvent.selectOptions(screen.getByLabelText(/Delivery terms/), "DAP");
    await userEvent.selectOptions(screen.getByLabelText("Reason for sending"), "sale");
    await userEvent.type(screen.getByLabelText(/EORI number/), "de123456789");
    await userEvent.click(screen.getByRole("button", { name: "Save declaration" }));

    expect(api.saveDeclaration).toHaveBeenCalledWith("S1", { incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: null, eori_number: "DE123456789", remarks: null });
    expect(await screen.findByRole("status")).toHaveTextContent("Your declaration has been saved.");
    expect(screen.getByRole("button", { name: "Update declaration" })).toBeInTheDocument();   // and the confirmation is not wiped by a re-render
  });

  it("points at the two required choices instead of sending", async () => {
    renderWithClient(<DeclarationForm shipmentId="S1" declaration={null} readOnly={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Save declaration" }));

    expect(screen.getByLabelText(/Delivery terms/)).toBeInvalid();
    expect(screen.getByLabelText("Reason for sending")).toBeInvalid();
    expect(api.saveDeclaration).not.toHaveBeenCalled();
  });

  it("shows the API's field errors beside the field", async () => {
    api.saveDeclaration.mockRejectedValue(new ApiError(422, "validation_failed", "x", { eori_number: ["The eori number field format is invalid."] }));
    renderWithClient(<DeclarationForm shipmentId="S1" declaration={declared} readOnly={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Update declaration" }));

    expect(await screen.findByText("The eori number field format is invalid.")).toBeInTheDocument();
  });

  it("explains a shipment that finished in the meantime", async () => {
    api.saveDeclaration.mockRejectedValue(new ApiError(409, "shipment_closed", "x"));
    renderWithClient(<DeclarationForm shipmentId="S1" declaration={declared} readOnly={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Update declaration" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("shipment is finished");
  });

  it("is read-only once the shipment is finished", () => {
    renderWithClient(<DeclarationForm shipmentId="S1" declaration={declared} readOnly />);

    expect(screen.getByLabelText(/Delivery terms/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /declaration/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can no longer be changed/)).toBeInTheDocument();
  });
});

describe("CustomsScreen", () => {
  it("says no paperwork is needed for a domestic shipment", () => {
    render(customs({ international: false, requirements: [] }));

    expect(screen.getByRole("status")).toHaveTextContent("stays within one country");
    expect(screen.queryByLabelText(/Delivery terms/)).not.toBeInTheDocument();
  });

  it("lists what is needed, what is on file and what is missing, with direction and whether it is required", () => {
    render();
    const rows = screen.getAllByRole("listitem").filter((li) => li.querySelector("p.font-medium"));
    const licence = rows.find((r) => r.textContent?.includes("Export licence"))!;

    expect(licence).toHaveTextContent("Leaving NG · required");
    expect(licence).toHaveTextContent("Missing");
    expect(licence).toHaveTextContent("Needed for goods over $1,000.");
    expect(licence).toHaveTextContent("No export licence on file.");
    const packing = rows.find((r) => r.textContent?.includes("Packing list"))!;
    expect(packing).toHaveTextContent("Entering DE · optional");
    expect(packing).toHaveTextContent("On file");
  });

  it("warns what is still needed before the shipment can leave, and confirms when it can", () => {
    const first = render();
    expect(screen.getByText(/Still needed before it can leave the country:/).closest("p")).toHaveTextContent("Export licence");
    first.unmount();

    render(customs({ requirements: customs().requirements.map((r) => ({ ...r, status: "satisfied" as const, reason: null })) }));
    expect(screen.getByText(/Every document we need before this shipment leaves the country is on file/)).toBeInTheDocument();
  });

  it.each([
    [{ status: "review_required", note: null }, "On hold for a compliance check"],
    [{ status: "rejected", note: "Prohibited item." }, "can't be accepted"],
    [{ status: "approved", note: "Looks fine." }, "reviewed and cleared"],
  ])("shows the compliance outcome %j", (compliance, text) => {
    render(customs({ compliance }));

    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
  });

  it("shows nothing about compliance when there is nothing to say", () => {
    render();

    expect(screen.queryByText(/compliance/i)).not.toBeInTheDocument();
  });

  it("keeps estimated duties apart from what customs actually charged", () => {
    render(customs({ assessed_charges: { note: "Amounts assessed by the customs authority.", items: [{ id: "C1", type: "duty", description: "Import duty", amount_minor: 1250, currency: "EUR", assessed_by: "German Customs", authority_reference: "REF-9", status: "assessed", paid_at: null }] } }));
    const [estimated, charged] = [screen.getByRole("heading", { name: "Estimated" }).parentElement!, screen.getByRole("heading", { name: "Charged by customs" }).parentElement!];

    expect(estimated).toHaveTextContent("Import duty (estimate)");
    expect(estimated).toHaveTextContent("not charges and not included in what you paid");
    expect(charged).toHaveTextContent("Import duty");
    expect(charged).toHaveTextContent("12.50");
    expect(charged).toHaveTextContent("German Customs · reference REF-9");
    expect(charged).toHaveTextContent("Payable");
    expect(estimated).not.toHaveTextContent("German Customs");
  });

  it("says plainly when customs has charged nothing", () => {
    render();

    expect(screen.getByText("Nothing has been charged by customs.")).toBeInTheDocument();
  });

  it("lists documents on file, marking the ones we created, and downloads them through a signed link", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    render(customs(), shipment({ documents: [
      { id: "D1", type: "export_licence", name: "licence.pdf", size: 204800, generated: false, removable: true, uploaded_at: "2026-10-16T08:00:00Z" },
      { id: "D2", type: "commercial_invoice", name: "commercial-invoice-LG1.pdf", size: 9000, generated: true, removable: false, uploaded_at: "2026-10-16T08:00:00Z" },
    ] }));
    const section = screen.getByRole("heading", { name: "Documents on file" }).parentElement!;

    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(section).toHaveTextContent("created for you");
    expect(section).toHaveTextContent("200 KB");

    await userEvent.click(within(section).getByRole("button", { name: /Download licence\.pdf/ }));
    const getLink = vi.mocked(download.openSignedLink).mock.calls[0][0];
    api.fetchDocumentLink.mockResolvedValue({ url: "x" });
    await getLink();
    expect(api.fetchDocumentLink).toHaveBeenCalledWith(shipment().id, "D1");
  });

  describe("removing an uploaded document", () => {
    const withDocs = () => render(customs(), shipment({ documents: [
      { id: "D1", type: "export_licence", name: "licence.pdf", size: 2048, generated: false, removable: true, uploaded_at: "2026-10-16T08:00:00Z" },
      { id: "D2", type: "packing_list", name: "packing-list.pdf", size: 2048, generated: true, removable: false, uploaded_at: "2026-10-16T08:00:00Z" },
      { id: "D3", type: "identification", name: "passport.jpg", size: 2048, generated: false, removable: false, uploaded_at: "2026-10-16T08:00:00Z" },
    ] }));

    it("offers removal only for documents the API says can still be removed", () => {
      withDocs();

      expect(screen.getByRole("button", { name: /^Remove licence\.pdf/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove packing-list\.pdf/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Remove passport\.jpg/ })).not.toBeInTheDocument();
    });

    it("asks first, and keeping it changes nothing", async () => {
      withDocs();

      await userEvent.click(screen.getByRole("button", { name: /^Remove licence\.pdf/ }));
      expect(screen.getByRole("group", { name: "Confirm removing licence.pdf" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

      expect(api.removeDocument).not.toHaveBeenCalled();
      expect(screen.queryByRole("group", { name: /Confirm removing/ })).not.toBeInTheDocument();
    });

    it("removes the document once confirmed", async () => {
      api.removeDocument.mockResolvedValue(undefined);
      withDocs();

      await userEvent.click(screen.getByRole("button", { name: /^Remove licence\.pdf/ }));
      await userEvent.click(screen.getByRole("button", { name: /^Yes, remove/ }));

      await waitFor(() => expect(api.removeDocument).toHaveBeenCalledWith(shipment().id, "D1"));
      await waitFor(() => expect(screen.queryByRole("group", { name: /Confirm removing/ })).not.toBeInTheDocument());
    });

    it("explains it when the shipment has meanwhile reached customs", async () => {
      api.removeDocument.mockRejectedValue(new ApiError(409, "document_locked", "This shipment is already with customs, so its documents can no longer be removed."));
      withDocs();

      await userEvent.click(screen.getByRole("button", { name: /^Remove licence\.pdf/ }));
      await userEvent.click(screen.getByRole("button", { name: /^Yes, remove/ }));

      expect(await screen.findByRole("alert")).toHaveTextContent("already with customs");
    });
  });

  it("is view-only once the shipment is finished", () => {
    render(customs(), shipment({ status: "delivered", status_label: "Delivered" }));

    expect(screen.queryByRole("button", { name: /^Upload / })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery terms/)).toBeDisabled();
  });
});

describe("uploading and creating documents", () => {
  const inputFor = (label: string) => screen.getByLabelText(`Choose ${label} file`) as HTMLInputElement;

  it("uploads a file for the requirement it was chosen under", async () => {
    api.uploadDocument.mockResolvedValue({ id: "D1", type: "export_licence", name: "licence.pdf", size: 8 });
    render();

    await userEvent.upload(inputFor("export licence"), pdf());

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument.mock.calls[0][0]).toBe(shipment().id);
    expect(api.uploadDocument.mock.calls[0][2]).toBe("export_licence");
    expect(await screen.findByText("licence.pdf was uploaded.")).toBeInTheDocument();
  });

  it("refuses unsuitable files before sending anything", async () => {
    render();

    await userEvent.upload(inputFor("export licence"), new File(["MZ"], "setup.exe", { type: "application/octet-stream" }), { applyAccept: false });

    expect(await screen.findByText("Only PDF, JPEG and PNG files are accepted.")).toBeInTheDocument();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it("refuses files over 10 MB", async () => {
    render();
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });

    await userEvent.upload(inputFor("export licence"), big);

    expect(await screen.findByText(/larger than 10 MB/)).toBeInTheDocument();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(422, "unsupported_media_type", "Only PDF, JPEG and PNG documents are accepted."), /genuine PDF, JPEG or PNG/],
    [new ApiError(422, "too_many_documents", "x"), /maximum of 20/],
    [new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again."), /couldn't reach the server/],
  ])("explains a failed upload (%#)", async (error, text) => {
    api.uploadDocument.mockRejectedValue(error);
    render();

    await userEvent.upload(inputFor("export licence"), pdf());

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("only offers to create the commercial invoice and packing list, and only after the declaration is saved", async () => {
    render();

    expect(screen.queryByRole("button", { name: /Create export licence/ })).not.toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create commercial invoice for me" });
    expect(create).toBeDisabled();
    expect(screen.getAllByText(/Save your customs declaration above first/)).toHaveLength(2);   // invoice and packing list
  });

  it("creates the document from the shipment's own details and downloads it", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue(null);
    render(customs({ declaration: declared }));

    await userEvent.click(screen.getByRole("button", { name: "Create commercial invoice for me" }));

    expect(await screen.findByText(/Commercial invoice created from your shipment details/)).toBeInTheDocument();
    api.generateCustomsPaper.mockResolvedValue({ url: "x" });
    await vi.mocked(download.openSignedLink).mock.calls[0][0]();
    expect(api.generateCustomsPaper).toHaveBeenCalledWith(shipment().id, "commercial-invoice");
  });

  it("shows why creating a document failed", async () => {
    vi.mocked(download.openSignedLink).mockResolvedValue("We couldn't prepare the download. Please try again.");
    render(customs({ declaration: declared }));

    await userEvent.click(screen.getByRole("button", { name: "Create commercial invoice for me" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't prepare the download");
  });
});

describe("CustomsView", () => {
  it("loads the overview and the shipment together", async () => {
    api.fetchCustoms.mockResolvedValue(customs());
    api.fetchShipment.mockResolvedValue(shipment());
    renderWithClient(<CustomsView id={shipment().id} />);

    expect(await screen.findByRole("heading", { name: "Customs declaration" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Shipment LG000000000001/ })).toHaveAttribute("href", `/shipments/${shipment().id}`);
  });

  it("says when the shipment can't be found, mentioning the guest's tab", async () => {
    api.fetchCustoms.mockRejectedValue(new ApiError(404, "not_found", "x"));
    api.fetchShipment.mockRejectedValue(new ApiError(404, "not_found", "x"));
    renderWithClient(<CustomsView id="S1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("same browser tab you booked in");
  });

  it("offers a retry for other failures", async () => {
    api.fetchCustoms.mockRejectedValue(new ApiError(500, "server_error", "x"));
    api.fetchShipment.mockResolvedValue(shipment());
    renderWithClient(<CustomsView id="S1" />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("link from the shipment page", () => {
  it("is offered for shipments that cross a border", async () => {
    api.fetchShipment.mockResolvedValue(shipment());
    renderWithClient(<ShipmentView id="S1" />);

    expect(await screen.findByRole("link", { name: "Complete customs details" })).toHaveAttribute("href", "/shipments/S1/customs");
  });

  it("is not offered for domestic shipments or cancelled ones", async () => {
    const domestic = shipment({ recipient: { ...shipment().recipient!, country: "NG" } });
    api.fetchShipment.mockResolvedValue(domestic);
    const first = renderWithClient(<ShipmentView id="S1" />);
    await screen.findByText("LG000000000001");
    expect(screen.queryByRole("link", { name: "Complete customs details" })).not.toBeInTheDocument();
    first.unmount();

    api.fetchShipment.mockResolvedValue(shipment({ status: "cancelled", status_label: "Cancelled", cancellable: false, payment: { ...shipment().payment, refunded: money(0), requires_payment: false } }));
    renderWithClient(<ShipmentView id="S1" />);
    await screen.findByText(/This booking was cancelled/);
    expect(screen.queryByRole("link", { name: "Complete customs details" })).not.toBeInTheDocument();
  });
});
