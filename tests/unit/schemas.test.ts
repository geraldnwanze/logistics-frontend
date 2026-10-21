import { describe, expect, it } from "vitest";
import { blockPropSchemas, menuResponseSchema, pageResponseSchema, settingsSchema } from "@/lib/cms/schemas";

describe("block prop schemas", () => {
  it("applies defaults", () => {
    const hero = blockPropSchemas.hero.parse({ headline: "Hi" });

    expect(hero.alignment).toBe("left");
    expect(hero.show_tracking).toBe(false);
  });

  it("rejects props that break the contract", () => {
    expect(blockPropSchemas.hero.safeParse({}).success).toBe(false);
    expect(blockPropSchemas.spacer.safeParse({ size: "huge" }).success).toBe(false);
    expect(blockPropSchemas.faq.safeParse({ items: [{ question: "Q" }] }).success).toBe(false);
  });

  it("covers every block type the API can store", () => {
    expect(Object.keys(blockPropSchemas).sort()).toEqual([
      "blog_listing", "contact_form", "cta", "destination_listing", "divider", "faq", "feature_grid", "gallery", "hero",
      "image_text", "logo_wall", "pricing_table", "quote_widget", "rich_text", "service_cards", "spacer", "stats",
      "testimonials", "tracking_widget", "video",
    ]);
  });
});

describe("API response schemas", () => {
  it("parses a published page payload", () => {
    const parsed = pageResponseSchema.parse({
      data: { id: "01", slug: "about-us", title: "About", blocks: [{ id: "b1", type: "rich_text", props: { html: "<p>x</p>" } }], meta: {}, published_at: null },
      redirect: null,
    });

    expect(parsed.data?.blocks[0].visibility).toEqual({ mobile: true, tablet: true, desktop: true });
  });

  it("parses a redirect payload", () => {
    const parsed = pageResponseSchema.parse({ data: null, redirect: { to: "/new", status: 301 } });

    expect(parsed.redirect?.to).toBe("/new");
  });

  it("parses nested menus", () => {
    const menu = menuResponseSchema.parse({
      data: { key: "header", locale: "en", items: [{ label: "A", type: "group", children: [{ label: "B", type: "page", href: "/b", children: [] }] }] },
    });

    expect(menu.data.items[0].children?.[0].href).toBe("/b");
  });

  it("rejects settings with a non-hex brand colour", () => {
    const base = {
      general: { business_name: "X" }, contact: {}, social: {}, layout: {}, announcement: { enabled: false },
      site: { maintenance_mode: false, cookie_banner_enabled: true }, seo: {},
    };

    expect(settingsSchema.safeParse({ ...base, branding: { primary_color: "red" } }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, branding: {} }).success).toBe(true);
  });
});
