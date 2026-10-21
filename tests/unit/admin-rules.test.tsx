import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeWhen, requirementFiltersFrom, requirementsHref } from "@/components/admin/requirements-screen";
import { restrictionFiltersFrom, restrictionsHref } from "@/components/admin/restrictions-screen";
import { DocumentRulesScreen, ScreeningRulesScreen } from "@/components/admin/screens";
import * as rulesApi from "@/lib/admin/rules";
import { emptyRequirementForm, emptyRestrictionForm, requirementToForm, requirementToInput, restrictionToForm, restrictionToInput, splitList, validateRequirement, validateRestriction, type Requirement, type Restriction } from "@/lib/admin/rules";
import { ApiError } from "@/lib/api/client";
import * as authApi from "@/lib/auth/api";
import { push, renderWithClient, replace, searchParams } from "./auth-support";
import { staff } from "./admin-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => searchParams, usePathname: () => "/admin/rules/screening" }));
vi.mock("@/lib/admin/rules", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/rules")>();

  return { ...real, fetchRestrictions: vi.fn(), createRestriction: vi.fn(), updateRestriction: vi.fn(), deleteRestriction: vi.fn(), fetchRequirements: vi.fn(), createRequirement: vi.fn(), updateRequirement: vi.fn(), deleteRequirement: vi.fn() };
});
vi.mock("@/lib/auth/api");

const api = vi.mocked(rulesApi);
const auth = vi.mocked(authApi);
const OFFICER = ["customs.manage", "shipments.view"];
const page = <T,>(items: T[]) => ({ items, page: 1, lastPage: 1, total: items.length });

const rule = (over: Partial<Restriction> = {}): Restriction => ({ id: 1, label: "Batteries", action: "restricted", country_code: null, applies_to: "any", keywords: ["battery", "lithium"], hs_prefixes: ["8507"], reason: "Lithium cells need special packing", is_active: true, ...over });
const requirement = (over: Partial<Requirement> = {}): Requirement => ({ id: 1, country_code: "NG", direction: "export", document_type: "export_licence", label: "Export licence", shipment_types: [], min_declared_value_minor: 0, value_currency: "USD", is_mandatory: true, requires_hs_code: false, notes: "Needed for goods leaving Nigeria.", is_active: true, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  auth.fetchCurrentUser.mockResolvedValue(staff(OFFICER));
});

describe("lists typed into a box", () => {
  it("splits on commas and lines, trims, and drops blanks and repeats", () => {
    expect(splitList(" battery, Lithium\nlithium cell ,, BATTERY ")).toEqual(["battery", "Lithium", "lithium cell"]);
    expect(splitList("")).toEqual([]);
  });
});

describe("screening rule form logic", () => {
  const ok = { ...emptyRestrictionForm, label: "Batteries", keywords: "battery" };

  it("needs a name, and at least one keyword or code prefix", () => {
    expect(validateRestriction(ok)).toEqual({});
    expect(validateRestriction({ ...ok, label: " " }).label).toMatch(/name/);
    expect(validateRestriction({ ...ok, keywords: "" }).keywords).toMatch(/at least one keyword/);
    expect(validateRestriction({ ...ok, keywords: "", prefixes: "8507" })).toEqual({});
  });

  it("checks keyword length, prefix shape and the country code", () => {
    expect(validateRestriction({ ...ok, keywords: "a" }).keywords).toMatch(/2 to 60/);
    expect(validateRestriction({ ...ok, keywords: "x".repeat(61) }).keywords).toMatch(/2 to 60/);
    expect(validateRestriction({ ...ok, prefixes: "85, abc" }).prefixes).toMatch(/2 to 10 digits/);
    expect(validateRestriction({ ...ok, country: "Germany" }).country).toMatch(/two-letter/);
  });

  it("sends clean lists, an upper-case country or none, and no empty reason", () => {
    expect(restrictionToInput({ ...ok, keywords: "Battery, battery,\nlithium", prefixes: "8507, 8506", country: "de", reason: "  " }))
      .toEqual({ label: "Batteries", action: "restricted", country_code: "DE", applies_to: "any", keywords: ["Battery", "lithium"], hs_prefixes: ["8507", "8506"], reason: null, is_active: true });
    expect(restrictionToInput(ok).country_code).toBeNull();
  });

  it("fills the form back from a saved rule", () => {
    expect(restrictionToForm(rule({ country_code: "DE", keywords: ["a1", "b2"], hs_prefixes: [] }))).toMatchObject({ label: "Batteries", country: "DE", keywords: "a1, b2", prefixes: "", active: true });
  });
});

describe("document requirement form logic", () => {
  const ok = { ...emptyRequirementForm, country: "ng", label: "Export licence" };

  it("needs a two-letter country, a label and a currency", () => {
    expect(validateRequirement(ok)).toEqual({});
    expect(validateRequirement({ ...ok, country: "N" }).country).toBeDefined();
    expect(validateRequirement({ ...ok, label: "" }).label).toBeDefined();
    expect(validateRequirement({ ...ok, currency: "US" }).currency).toBeDefined();
  });

  it("holds the value threshold to the currency's own decimals", () => {
    expect(validateRequirement({ ...ok, minValue: "100.50" })).toEqual({});
    expect(validateRequirement({ ...ok, minValue: "100.505" }).minValue).toMatch(/at most 2 decimal places/);
    expect(validateRequirement({ ...ok, minValue: "100.5", currency: "JPY" }).minValue).toMatch(/at most 0 decimal places/);
  });

  it("turns the threshold into minor units, and no kinds ticked into 'every kind'", () => {
    expect(requirementToInput({ ...ok, minValue: "250.00" })).toMatchObject({ country_code: "NG", min_declared_value_minor: 25000, value_currency: "USD", shipment_types: null });
    expect(requirementToInput({ ...ok, minValue: "5000", currency: "jpy", types: ["parcel", "freight"] })).toMatchObject({ min_declared_value_minor: 5000, value_currency: "JPY", shipment_types: ["parcel", "freight"] });
    expect(requirementToInput(ok).min_declared_value_minor).toBe(0);
  });

  it("shows a saved threshold back in major units", () => {
    expect(requirementToForm(requirement({ min_declared_value_minor: 25050 })).minValue).toBe("250.50");
    expect(requirementToForm(requirement({ min_declared_value_minor: 5000, value_currency: "JPY" })).minValue).toBe("5000");
    expect(requirementToForm(requirement()).minValue).toBe("");
  });

  it("says when a requirement applies", () => {
    expect(describeWhen(requirement())).toBe("For every kind of shipment, of any value.");
    expect(describeWhen(requirement({ shipment_types: ["parcel", "freight"], min_declared_value_minor: 100000 }))).toBe("For parcels, freight, declared at $1,000.00 or more.");
  });
});

describe("filters in the address", () => {
  it("reads only values the API knows", () => {
    expect(restrictionFiltersFrom(new URLSearchParams("action=prohibited&active=0&country=de&q=%20bat%20&page=2"))).toEqual({ action: "prohibited", active: "0", country: "DE", q: "bat", page: 2 });
    expect(restrictionFiltersFrom(new URLSearchParams("action=x&active=maybe&country=GER"))).toMatchObject({ action: undefined, active: undefined, country: undefined });
    expect(requirementFiltersFrom(new URLSearchParams("country=ng&direction=import"))).toMatchObject({ country: "NG", direction: "import" });
    expect(requirementFiltersFrom(new URLSearchParams("direction=sideways")).direction).toBeUndefined();
  });

  it("builds the address back", () => {
    expect(restrictionsHref({})).toBe("/admin/rules/screening");
    expect(restrictionsHref({ action: "restricted", active: "1", q: "a b" }, 2)).toBe("/admin/rules/screening?action=restricted&active=1&q=a+b&page=2");
    expect(requirementsHref({ country: "DE", direction: "export" })).toBe("/admin/rules/documents?country=DE&direction=export");
  });
});

describe("screening rules screen", () => {
  const open = () => renderWithClient(<ScreeningRulesScreen />);

  it("is closed to people who don't manage customs", async () => {
    auth.fetchCurrentUser.mockResolvedValue(staff(["shipments.view"]));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't have access");
    expect(api.fetchRestrictions).not.toHaveBeenCalled();
  });

  it("lists rules with what happens, where, the words they catch and why", async () => {
    api.fetchRestrictions.mockResolvedValue(page([rule(), rule({ id: 2, label: "Firearms", action: "prohibited", country_code: "DE", applies_to: "destination", keywords: ["firearm"], hs_prefixes: [], reason: null, is_active: false })]));
    open();

    const first = (await screen.findByText("Batteries", { selector: "p" })).closest("li")!;
    expect(first).toHaveTextContent("Restricted");
    expect(first).toHaveTextContent("Origin or destination · every country");
    expect(first).toHaveTextContent("Keywords: battery, lithium");
    expect(first).toHaveTextContent("Code prefixes: 8507");
    const second = screen.getByText("Firearms", { selector: "p" }).closest("li")!;
    expect(second).toHaveTextContent("Prohibited");
    expect(second).toHaveTextContent("Sending to · only DE");
    expect(second).toHaveTextContent("Not in use");
    expect(screen.getByText("2 rules")).toBeInTheDocument();
  });

  it("filters through the address", async () => {
    searchParams.set("action", "prohibited");
    api.fetchRestrictions.mockResolvedValue(page([rule()]));
    open();
    await screen.findByText("Batteries", { selector: "p" });

    expect(api.fetchRestrictions.mock.calls[0][0]).toMatchObject({ action: "prohibited" });
    await userEvent.selectOptions(screen.getByLabelText("In use"), "Not in use");
    expect(replace).toHaveBeenLastCalledWith("/admin/rules/screening?action=prohibited&active=0");
    await userEvent.type(screen.getByLabelText("Country"), "de");
    await userEvent.type(screen.getByLabelText("Name"), "bat");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("country=DE"));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=bat"));
  });

  it("says when there are none, and when it can't load", async () => {
    api.fetchRestrictions.mockRejectedValueOnce(new ApiError(500, "server", "x")).mockResolvedValueOnce(page([]));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("There are no screening rules yet.")).toBeInTheDocument();
  });

  it("adds a rule after checking the form, sending clean data", async () => {
    api.fetchRestrictions.mockResolvedValue(page([]));
    api.createRestriction.mockResolvedValue(rule());
    open();
    await userEvent.click(await screen.findByRole("button", { name: "New rule" }));
    const form = screen.getByRole("form", { name: "Add rule" });

    await userEvent.click(within(form).getByRole("button", { name: "Add rule" }));
    expect(within(form).getByText("Give the rule a name people will recognise.")).toBeInTheDocument();
    expect(within(form).getByText(/Add at least one keyword/)).toBeInTheDocument();
    expect(api.createRestriction).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByLabelText("Name"), "Batteries");
    await userEvent.type(within(form).getByLabelText("Keywords"), "battery, lithium");
    await userEvent.type(within(form).getByLabelText(/Customs code prefixes/), "8507");
    await userEvent.type(within(form).getByLabelText(/Reason/), "Needs packing");
    await userEvent.click(within(form).getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(api.createRestriction).toHaveBeenCalledWith({ label: "Batteries", action: "restricted", country_code: null, applies_to: "any", keywords: ["battery", "lithium"], hs_prefixes: ["8507"], reason: "Needs packing", is_active: true }));
    expect(await screen.findByText("“Batteries” was added.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add rule" })).not.toBeInTheDocument();
  });

  it("shows the API's own words when it refuses, and keeps what was typed", async () => {
    api.fetchRestrictions.mockResolvedValue(page([]));
    api.createRestriction.mockRejectedValue(new ApiError(422, "validation_failed", "The given data was invalid.", { country_code: ["The selected country code is invalid."] }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "New rule" }));
    const form = screen.getByRole("form", { name: "Add rule" });
    await userEvent.type(within(form).getByLabelText("Name"), "Batteries");
    await userEvent.type(within(form).getByLabelText("Keywords"), "battery");
    await userEvent.type(within(form).getByLabelText(/Only for this country/), "ZZ");
    await userEvent.click(within(form).getByRole("button", { name: "Add rule" }));

    expect(await within(form).findByText("The selected country code is invalid.")).toBeInTheDocument();
    expect(within(form).getByLabelText("Name")).toHaveValue("Batteries");
  });

  it("edits a rule in place, starting from what it says now", async () => {
    api.fetchRestrictions.mockResolvedValue(page([rule()]));
    api.updateRestriction.mockResolvedValue(rule({ action: "prohibited" }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Edit Batteries/ }));
    const form = screen.getByRole("form", { name: "Save changes" });

    expect(within(form).getByLabelText("Name")).toHaveValue("Batteries");
    expect(within(form).getByLabelText("Keywords")).toHaveValue("battery, lithium");
    await userEvent.selectOptions(within(form).getByLabelText("What happens"), "Prohibited: refuse the booking");
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateRestriction).toHaveBeenCalledWith(1, expect.objectContaining({ label: "Batteries", action: "prohibited", keywords: ["battery", "lithium"] })));
    expect(await screen.findByText("“Batteries” was saved.")).toBeInTheDocument();
  });

  it("turns a rule off and on without deleting it", async () => {
    api.fetchRestrictions.mockResolvedValue(page([rule()]));
    api.updateRestriction.mockResolvedValue(rule({ is_active: false }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Turn off Batteries/ }));

    await waitFor(() => expect(api.updateRestriction).toHaveBeenCalledWith(1, { is_active: false }));
    expect(await screen.findByText("“Batteries” is now off.")).toBeInTheDocument();
  });

  it("asks before deleting, and says what that means", async () => {
    api.fetchRestrictions.mockResolvedValue(page([rule()]));
    api.deleteRestriction.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Delete Batteries/ }));
    expect(screen.getByRole("group", { name: "Confirm deleting Batteries" })).toHaveTextContent("will no longer be screened");
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.deleteRestriction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Delete Batteries/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(api.deleteRestriction).toHaveBeenCalledWith(1));
    expect(await screen.findByText("“Batteries” was deleted.")).toBeInTheDocument();
  });

  it("shows why a delete was refused", async () => {
    api.fetchRestrictions.mockResolvedValue(page([rule()]));
    api.deleteRestriction.mockRejectedValue(new ApiError(409, "in_use", "This record is referenced by other data and cannot be deleted. Disable or archive it instead."));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Delete Batteries/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be deleted. Disable or archive it instead.");
  });
});

describe("document requirements screen", () => {
  const open = () => renderWithClient(<DocumentRulesScreen />);

  it("lists requirements with country, direction, document and when they apply", async () => {
    api.fetchRequirements.mockResolvedValue(page([requirement(), requirement({ id: 2, country_code: "DE", direction: "import", document_type: "commercial_invoice", label: "Commercial invoice", is_mandatory: false, shipment_types: ["parcel"], min_declared_value_minor: 15000, requires_hs_code: true, notes: null })]));
    open();

    const first = (await screen.findByText(/NG · Leaving the country/)).closest("li")!;
    expect(first).toHaveTextContent("Export licence: “Export licence”");
    expect(first).toHaveTextContent("For every kind of shipment, of any value.");
    expect(first).toHaveTextContent("Required");
    const second = screen.getByText(/DE · Arriving in the country/).closest("li")!;
    expect(second).toHaveTextContent("For parcels, declared at $150.00 or more. Items need a customs code.");
    expect(second).toHaveTextContent("Optional");
  });

  it("adds a requirement with the value threshold in minor units", async () => {
    api.fetchRequirements.mockResolvedValue(page([]));
    api.createRequirement.mockResolvedValue(requirement());
    open();
    await userEvent.click(await screen.findByRole("button", { name: "New requirement" }));
    const form = screen.getByRole("form", { name: "Add requirement" });

    await userEvent.click(within(form).getByRole("button", { name: "Add requirement" }));
    expect(within(form).getByText("Use the two-letter country code, for example DE.")).toBeInTheDocument();
    expect(within(form).getByText(/Say what the customer is asked for/)).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText("Country"), "de");
    await userEvent.type(within(form).getByLabelText("What the customer sees"), "Commercial invoice");
    await userEvent.selectOptions(within(form).getByLabelText("Which way"), "Arriving in the country");
    await userEvent.click(within(form).getByLabelText("Parcels"));
    await userEvent.type(within(form).getByLabelText(/Only when the declared value/), "150.00");
    await userEvent.click(within(form).getByRole("button", { name: "Add requirement" }));

    await waitFor(() => expect(api.createRequirement).toHaveBeenCalledWith(expect.objectContaining({ country_code: "DE", direction: "import", label: "Commercial invoice", shipment_types: ["parcel"], min_declared_value_minor: 15000, value_currency: "USD", is_mandatory: true })));
    expect(await screen.findByText("A requirement for DE was added.")).toBeInTheDocument();
  });

  it("edits a requirement from what it says now", async () => {
    api.fetchRequirements.mockResolvedValue(page([requirement({ min_declared_value_minor: 15050, shipment_types: ["parcel"] })]));
    api.updateRequirement.mockResolvedValue(requirement());
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Edit Export licence for NG/ }));
    const form = screen.getByRole("form", { name: "Save changes" });

    expect(within(form).getByLabelText(/Only when the declared value/)).toHaveValue("150.50");
    expect(within(form).getByLabelText("Parcels")).toBeChecked();
    await userEvent.click(within(form).getByLabelText("Required before the shipment can leave"));
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateRequirement).toHaveBeenCalledWith(1, expect.objectContaining({ is_mandatory: false, min_declared_value_minor: 15050, shipment_types: ["parcel"] })));
  });

  it("turns one off, and deletes only after asking", async () => {
    api.fetchRequirements.mockResolvedValue(page([requirement()]));
    api.updateRequirement.mockResolvedValue(requirement({ is_active: false }));
    api.deleteRequirement.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Turn off Export licence for NG/ }));
    await waitFor(() => expect(api.updateRequirement).toHaveBeenCalledWith(1, { is_active: false }));

    await userEvent.click(await screen.findByRole("button", { name: /Delete Export licence for NG/ }));
    expect(screen.getByRole("group", { name: /Confirm deleting/ })).toHaveTextContent("Customers will no longer be asked for it");
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(api.deleteRequirement).toHaveBeenCalledWith(1));
  });

  it("filters by country and direction through the address", async () => {
    api.fetchRequirements.mockResolvedValue(page([requirement()]));
    open();
    await screen.findByText(/NG · Leaving/);

    await userEvent.selectOptions(screen.getByLabelText("Which way"), "Arriving in the country");
    expect(replace).toHaveBeenLastCalledWith("/admin/rules/documents?direction=import");
    await userEvent.type(screen.getByLabelText("Country"), "de");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("country=DE"));
  });
});
