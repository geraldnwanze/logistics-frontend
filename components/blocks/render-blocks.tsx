import type { ReactNode } from "react";
import { blockPropSchemas, type BlockEnvelope, type BlockProps, type BlockType } from "@/lib/cms/schemas";
import { cn } from "@/lib/utils";
import { Faq } from "./faq-block";
import { Container, SectionHeading } from "./shared";
import { Cta, Divider, FeatureGrid, Gallery, Hero, ImageText, LogoWall, PricingTable, RichText, Spacer, Stats, Video } from "./static-blocks";
import { TrackingForm } from "./tracking-widget";
import { Unavailable } from "./unavailable";

type Renderer<T extends BlockType> = (props: BlockProps<T>, context: { first: boolean }) => ReactNode;

/**
 * The component registry: every block type the API can store and its renderer.
 * An unknown or invalid block is skipped, never rendered raw.
 */
const renderers: { [T in BlockType]: Renderer<T> } = {
  hero: (props, { first }) => <Hero props={props} first={first} />,
  rich_text: (props) => <RichText props={props} />,
  image_text: (props) => <ImageText props={props} />,
  gallery: (props) => <Gallery props={props} />,
  feature_grid: (props) => <FeatureGrid props={props} />,
  stats: (props) => <Stats props={props} />,
  pricing_table: (props) => <PricingTable props={props} />,
  cta: (props) => <Cta props={props} />,
  video: (props) => <Video props={props} />,
  logo_wall: (props) => <LogoWall props={props} />,
  spacer: (props) => <Spacer props={props} />,
  divider: (props) => <Divider props={props} />,
  faq: (props) => <Faq props={props} />,
  tracking_widget: (props) => (
    <Container className="max-w-2xl py-12">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <TrackingForm placeholder={props.placeholder} />
      {props.help_text ? <p className="mt-3 text-sm opacity-75">{props.help_text}</p> : null}
    </Container>
  ),
  quote_widget: () => <Unavailable type="quote_widget" needs="the quotation API (Phase 4)" />,
  service_cards: () => <Unavailable type="service_cards" needs="the service catalogue (Phase 4)" />,
  testimonials: () => <Unavailable type="testimonials" needs="the testimonials content module" />,
  blog_listing: () => <Unavailable type="blog_listing" needs="the blog content module" />,
  destination_listing: () => <Unavailable type="destination_listing" needs="the destinations content module" />,
  contact_form: () => <Unavailable type="contact_form" needs="the contact submission endpoint" />,
};

const BACKGROUNDS = { none: "", light: "bg-foreground/5", dark: "bg-secondary text-white", brand: "bg-brand text-brand-foreground" } as const;

function visibilityClasses(visibility: BlockEnvelope["visibility"]): string {
  return cn(
    !visibility.mobile && "max-md:hidden",
    !visibility.tablet && "md:max-lg:hidden",
    !visibility.desktop && "lg:hidden",
  );
}

function renderOne<T extends BlockType>(type: T, rawProps: unknown, first: boolean): ReactNode {
  const parsed = blockPropSchemas[type].safeParse(rawProps);

  if (!parsed.success) {
    console.warn(`Skipping invalid ${type} block`, parsed.error.issues[0]);

    return null;
  }

  return (renderers[type] as Renderer<T>)(parsed.data as BlockProps<T>, { first });
}

export function RenderBlocks({ blocks }: { blocks: BlockEnvelope[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (!(block.type in blockPropSchemas)) {
          return null;
        }

        const content = renderOne(block.type as BlockType, block.props, index === 0);

        if (content === null) {
          return null;
        }

        return (
          <section
            key={block.id}
            id={block.anchor ?? undefined}
            className={cn(BACKGROUNDS[block.style.background ?? "none"], visibilityClasses(block.visibility))}
          >
            {content}
          </section>
        );
      })}
    </>
  );
}
