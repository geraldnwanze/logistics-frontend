import type { SiteSettings } from "@/lib/cms/schemas";

/** Black or white text, whichever has more contrast on the given #rrggbb colour. */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.4 ? "#111827" : "#ffffff";
}

const FONT_VARIABLES: Record<string, string> = {
  inter: "var(--font-inter)",
  "source-sans": "var(--font-source-sans)",
  merriweather: "var(--font-merriweather)",
  "work-sans": "var(--font-work-sans)",
  system: "ui-sans-serif, system-ui, sans-serif",
};

/** CSS custom properties from branding settings. Colours are regex-validated hex, fonts come from an allow-list. */
export function themeVariables(branding: SiteSettings["branding"]): Record<string, string> {
  return {
    "--brand": branding.primary_color,
    "--brand-fg": readableOn(branding.primary_color),
    "--secondary": branding.secondary_color,
    "--accent": branding.accent_color,
    "--accent-fg": readableOn(branding.accent_color),
    "--font-body": FONT_VARIABLES[branding.body_font] ?? FONT_VARIABLES.inter,
    "--font-display": FONT_VARIABLES[branding.heading_font] ?? FONT_VARIABLES.inter,
  };
}
