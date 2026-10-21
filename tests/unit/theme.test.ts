import { describe, expect, it } from "vitest";
import type { SiteSettings } from "@/lib/cms/schemas";
import { themeVariables } from "@/lib/theme";

const branding = (overrides: Partial<SiteSettings["branding"]> = {}): SiteSettings["branding"] => ({
  primary_color: "#0b3c6f", secondary_color: "#14213d", accent_color: "#f5a524", heading_font: "inter", body_font: "inter", ...overrides,
});

describe("themeVariables", () => {
  it("maps brand colours to CSS variables", () => {
    const vars = themeVariables(branding());

    expect(vars["--brand"]).toBe("#0b3c6f");
    expect(vars["--accent"]).toBe("#f5a524");
  });

  it("chooses readable foreground colours", () => {
    expect(themeVariables(branding({ primary_color: "#0b3c6f" }))["--brand-fg"]).toBe("#ffffff");
    expect(themeVariables(branding({ primary_color: "#ffe066" }))["--brand-fg"]).toBe("#111827");
    expect(themeVariables(branding({ accent_color: "#f5a524" }))["--accent-fg"]).toBe("#111827");
  });

  it("falls back to the default font for unknown names", () => {
    expect(themeVariables(branding({ body_font: "comic-sans" }))["--font-body"]).toBe("var(--font-inter)");
    expect(themeVariables(branding({ heading_font: "merriweather" }))["--font-display"]).toBe("var(--font-merriweather)");
  });
});
