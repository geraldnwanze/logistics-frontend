export const DOCUMENT_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial invoice", packing_list: "Packing list", export_licence: "Export licence", certificate_of_origin: "Certificate of origin",
  import_permit: "Import permit", identification: "Identification", other: "Other document",
};

export const INCOTERMS: { value: string; label: string }[] = [
  { value: "EXW", label: "EXW — Ex Works" }, { value: "FCA", label: "FCA — Free Carrier" }, { value: "CPT", label: "CPT — Carriage Paid To" },
  { value: "CIP", label: "CIP — Carriage and Insurance Paid To" }, { value: "DAP", label: "DAP — Delivered At Place" }, { value: "DPU", label: "DPU — Delivered At Place Unloaded" },
  { value: "DDP", label: "DDP — Delivered Duty Paid" }, { value: "FAS", label: "FAS — Free Alongside Ship" }, { value: "FOB", label: "FOB — Free On Board" },
  { value: "CFR", label: "CFR — Cost and Freight" }, { value: "CIF", label: "CIF — Cost, Insurance and Freight" },
];

export const EXPORT_REASONS: { value: string; label: string }[] = [
  { value: "sale", label: "Sale of goods" }, { value: "gift", label: "Gift" }, { value: "sample", label: "Commercial sample" }, { value: "return", label: "Returned goods" },
  { value: "repair", label: "Repair or replacement" }, { value: "personal", label: "Personal effects" }, { value: "other", label: "Other" },
];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = [{ ext: ["pdf"], mime: "application/pdf" }, { ext: ["jpg", "jpeg"], mime: "image/jpeg" }, { ext: ["png"], mime: "image/png" }];

/** The quick checks a browser can do before sending; the server inspects the real file content and has the final say. */
export function uploadProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "This file is larger than 10 MB. Please send a smaller scan.";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const known = ALLOWED.some((a) => a.ext.includes(extension) && (file.type === "" || file.type === a.mime));

  return known ? null : "Only PDF, JPEG and PNG files are accepted.";
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function chargeAmount(minor: number, currency: string): string {
  let decimals = 2;

  try {
    decimals = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* unknown currency code: show with two decimals */
  }

  const amount = (minor / 10 ** decimals).toFixed(decimals);   // display only

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: decimals }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
