import { z } from "zod";

const text = z.string().nullish();

export const mediaSchema = z
  .object({
    media_id: z.string(),
    url: z.string().nullish(),
    alt: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
  })
  .nullish();

export const linkSchema = z.object({ label: z.string(), href: z.string() }).nullish();

const heading = { heading: text, intro: text };

/**
 * Props per block type. Mirrors App\Cms\Blocks\BlockRegistry on the API; the API is the
 * authority, this only gives the renderer typed, defaulted values.
 */
export const blockPropSchemas = {
  hero: z.object({
    eyebrow: text, headline: z.string(), subheadline: text,
    show_tracking: z.boolean().default(false), alignment: z.enum(["left", "center"]).default("left"),
    background: mediaSchema, primary_cta: linkSchema, secondary_cta: linkSchema,
  }),
  rich_text: z.object({ html: z.string() }),
  image_text: z.object({
    ...heading, html: text, image_position: z.enum(["left", "right"]).default("right"), image: mediaSchema, cta: linkSchema,
  }),
  gallery: z.object({
    ...heading, columns: z.number().default(3),
    images: z.array(z.object({ media: mediaSchema, caption: text })),
  }),
  feature_grid: z.object({
    ...heading, columns: z.number().default(3),
    items: z.array(z.object({ icon: text, title: z.string(), text })),
  }),
  stats: z.object({ ...heading, items: z.array(z.object({ value: z.string(), label: z.string() })) }),
  service_cards: z.object({ ...heading, limit: z.number().nullish(), featured_only: z.boolean().default(false) }),
  pricing_table: z.object({
    ...heading,
    plans: z.array(z.object({
      name: z.string(), price_label: text, description: text, features: z.array(z.string()).default([]),
      highlighted: z.boolean().default(false), cta: linkSchema,
    })),
  }),
  tracking_widget: z.object({ ...heading, placeholder: text, help_text: text }),
  quote_widget: z.object({ ...heading }),
  testimonials: z.object({ ...heading, limit: z.number().nullish() }),
  faq: z.object({ ...heading, items: z.array(z.object({ question: z.string(), answer_html: z.string() })) }),
  cta: z.object({
    heading: z.string(), text, tone: z.enum(["light", "dark", "brand"]).default("brand"), primary: linkSchema, secondary: linkSchema,
  }),
  video: z.object({ url: z.string(), title: z.string(), caption: text }),
  logo_wall: z.object({
    ...heading,
    logos: z.array(z.object({ name: z.string(), media: mediaSchema, href: text })),
  }),
  contact_form: z.object({ ...heading, topic: text, success_message: text }),
  blog_listing: z.object({ ...heading, limit: z.number().nullish(), category: text }),
  destination_listing: z.object({ ...heading, limit: z.number().nullish(), featured_only: z.boolean().default(false) }),
  spacer: z.object({ size: z.enum(["sm", "md", "lg", "xl"]) }),
  divider: z.object({ line: z.enum(["solid", "dotted"]).nullish() }),
} as const;

export type BlockType = keyof typeof blockPropSchemas;
export type BlockProps<T extends BlockType> = z.infer<(typeof blockPropSchemas)[T]>;
export type Media = z.infer<typeof mediaSchema>;
export type Link = z.infer<typeof linkSchema>;

export const blockEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  visibility: z.object({ mobile: z.boolean(), tablet: z.boolean(), desktop: z.boolean() }).default({ mobile: true, tablet: true, desktop: true }),
  style: z.object({ background: z.enum(["none", "light", "dark", "brand"]).nullish(), align: text }).default({ background: "none" }),
  anchor: text,
});
export type BlockEnvelope = z.infer<typeof blockEnvelopeSchema>;

export const pageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  blocks: z.array(blockEnvelopeSchema),
  meta: z.object({
    title: text, description: text, noindex: z.boolean().nullish(), og_image: mediaSchema.or(z.string()).nullish(),
  }).default({}),
  published_at: text,
});
export type CmsPage = z.infer<typeof pageSchema>;

export const pageResponseSchema = z.object({
  data: pageSchema.nullable(),
  redirect: z.object({ to: z.string(), status: z.number() }).nullable().optional(),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const settingsSchema = z.object({
  general: z.object({
    business_name: z.string(), tagline: text, logo: mediaSchema, logo_alt: mediaSchema, favicon: mediaSchema,
    default_locale: z.string().default("en"),
  }),
  branding: z.object({
    primary_color: hex.default("#0B3C6F"), secondary_color: hex.default("#14213D"), accent_color: hex.default("#F5A524"),
    heading_font: z.string().default("inter"), body_font: z.string().default("inter"),
  }),
  contact: z.object({
    email: text, phone: text, support_email: text, support_phone: text, support_hours: text,
    addresses: z.array(z.object({ label: z.string(), text: z.string() })).nullish(),
  }),
  social: z.object({ facebook: text, x: text, instagram: text, linkedin: text, youtube: text }),
  layout: z.object({ header_style: z.enum(["standard", "centered", "compact"]).default("standard"), footer_columns: z.number().default(4) }),
  announcement: z.object({
    enabled: z.boolean(), text, link: text, tone: z.enum(["info", "warning", "promo"]).default("info"),
  }),
  site: z.object({ maintenance_mode: z.boolean(), maintenance_message: text, cookie_banner_enabled: z.boolean(), cookie_banner_text: text }),
  seo: z.object({ default_title: text, default_description: text, default_og_image: mediaSchema }),
});
export type SiteSettings = z.infer<typeof settingsSchema>;

export type MenuItem = {
  label: string; type: string; href?: string | null; icon?: string | null; audience?: string | null; children?: MenuItem[];
};
const menuItemSchema: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
    label: z.string(), type: z.string(), href: z.string().nullish(), icon: z.string().nullish(),
    audience: z.string().nullish(), children: z.array(menuItemSchema).optional(),
  }),
);
export const menuResponseSchema = z.object({
  data: z.object({ key: z.string(), locale: z.string(), items: z.array(menuItemSchema) }),
});
export type Menu = z.infer<typeof menuResponseSchema>["data"];
