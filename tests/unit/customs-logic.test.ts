import { describe, expect, it, vi } from "vitest";
import { toPayload, toValues, validateDeclaration } from "@/components/customs/declaration-form";
import * as shippingApi from "@/lib/shipping/api";
import { chargeAmount, formatBytes, MAX_UPLOAD_BYTES, uploadProblem } from "@/lib/shipping/customs-labels";
import { customsSchema } from "@/lib/shipping/schemas";
import { customs } from "./shipping-fixtures";

describe("uploadProblem", () => {
  const file = (name: string, size = 1000, type = "") => ({ name, size, type });

  it.each([["scan.pdf", "application/pdf"], ["photo.JPG", "image/jpeg"], ["photo.jpeg", "image/jpeg"], ["id.png", "image/png"], ["noType.pdf", ""]])("accepts %s", (name, type) => {
    expect(uploadProblem(file(name, 1000, type))).toBeNull();
  });

  it.each([["malware.exe", "application/octet-stream"], ["page.html", "text/html"], ["archive.zip", "application/zip"], ["noextension", ""], ["double.pdf.exe", ""], ["fake.pdf", "image/png"]])("refuses %s", (name, type) => {
    expect(uploadProblem(file(name, 1000, type))).toBe("Only PDF, JPEG and PNG files are accepted.");
  });

  it("refuses empty and oversized files, with the size limit stated in the message", () => {
    expect(uploadProblem(file("a.pdf", 0))).toBe("This file is empty.");
    expect(uploadProblem(file("a.pdf", MAX_UPLOAD_BYTES))).toBeNull();
    expect(uploadProblem(file("a.pdf", MAX_UPLOAD_BYTES + 1))).toMatch(/larger than 10 MB/);
  });
});

describe("display helpers", () => {
  it("shows file sizes plainly", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });

  it("formats customs amounts using the currency's own decimals", () => {
    expect(chargeAmount(400, "USD")).toContain("4.00");
    expect(chargeAmount(500, "JPY")).toContain("500");
    expect(chargeAmount(250, "NOT-A-CODE")).toBe("2.50 NOT-A-CODE");
  });
});

describe("declaration values", () => {
  const empty = toValues(null);
  const filled = { ...empty, incoterm: "DAP", reason_for_export: "sale" };

  it("starts empty for a new declaration and from the saved values for an existing one", () => {
    expect(empty).toEqual({ incoterm: "", reason_for_export: "", exporter_tax_id: "", consignee_tax_id: "", eori_number: "", remarks: "" });
    expect(toValues({ incoterm: "DDP", reason_for_export: "gift", exporter_tax_id: null, consignee_tax_id: "X1", eori_number: null, remarks: null })).toMatchObject({ incoterm: "DDP", consignee_tax_id: "X1", eori_number: "" });
  });

  it("requires the two choices and checks the EORI format and lengths", () => {
    expect(validateDeclaration(empty)).toMatchObject({ incoterm: expect.any(String), reason_for_export: expect.any(String) });
    expect(validateDeclaration(filled)).toEqual({});
    expect(validateDeclaration({ ...filled, eori_number: "de123456789" })).toEqual({});
    expect(validateDeclaration({ ...filled, eori_number: "12345" })).toHaveProperty("eori_number");
    expect(validateDeclaration({ ...filled, eori_number: "DE1234567890123456" })).toHaveProperty("eori_number");
    expect(validateDeclaration({ ...filled, remarks: "x".repeat(1001) })).toHaveProperty("remarks");
  });

  it("sends cleared optional boxes as null, trims, and upper-cases the EORI", () => {
    expect(toPayload({ ...filled, exporter_tax_id: "  ", consignee_tax_id: " NG-1 ", eori_number: " de123 ", remarks: "" })).toEqual({
      incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: "NG-1", eori_number: "DE123", remarks: null,
    });
  });
});

describe("customs schema", () => {
  it("accepts what the API sends, with and without a declaration", () => {
    expect(customsSchema.safeParse(customs()).success).toBe(true);
    expect(customsSchema.safeParse(customs({ declaration: { incoterm: "DAP", reason_for_export: "sale", exporter_tax_id: null, consignee_tax_id: null, eori_number: null, remarks: null } })).success).toBe(true);
  });

  it("rejects a checklist entry with an unknown status rather than guessing", () => {
    const bad = customs();
    (bad.requirements[0] as { status: string }).status = "maybe";

    expect(customsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("uploadDocument", () => {
  it("sends the file and its type as multipart form data", async () => {
    const real = await vi.importActual<typeof import("@/lib/shipping/api")>("@/lib/shipping/api");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "D1", type: "export_licence", name: "licence.pdf", size: 4 } }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "XSRF-TOKEN=t; path=/";

    const result = await real.uploadDocument("S1", new File(["%PDF"], "licence.pdf", { type: "application/pdf" }), "export_licence");

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(result).toMatchObject({ id: "D1" });
    expect(body.get("type")).toBe("export_licence");
    expect((body.get("file") as File).name).toBe("licence.pdf");
    vi.unstubAllGlobals();
    void shippingApi;
  });
});
