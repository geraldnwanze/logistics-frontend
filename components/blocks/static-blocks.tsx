import type { BlockProps } from "@/lib/cms/schemas";
import { CmsImage } from "@/components/site/cms-image";
import { CmsLink } from "@/components/site/cms-link";
import { cn } from "@/lib/utils";
import { CmsIcon } from "./icons";
import { Container, CtaLink, RichHtml, SectionHeading } from "./shared";
import { TrackingForm } from "./tracking-widget";

export function Hero({ props, first }: { props: BlockProps<"hero">; first: boolean }) {
  const centered = props.alignment === "center";

  return (
    <div className="relative isolate overflow-hidden bg-secondary text-white">
      {props.background?.url ? (
        <div className="absolute inset-0 -z-10">
          <CmsImage media={props.background} fill priority={first} className="opacity-35" />
        </div>
      ) : null}
      <Container className={cn("py-20 sm:py-28", centered && "text-center")}>
        {props.eyebrow ? <p className="mb-3 text-sm font-semibold tracking-widest text-accent uppercase">{props.eyebrow}</p> : null}
        <h1 className={cn("max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl", centered && "mx-auto")}>{props.headline}</h1>
        {props.subheadline ? <p className={cn("mt-5 max-w-2xl text-lg text-white/85", centered && "mx-auto")}>{props.subheadline}</p> : null}
        {props.show_tracking ? (
          <div className={cn("mt-8 max-w-xl", centered && "mx-auto")}>
            <TrackingForm tone="dark" />
          </div>
        ) : null}
        <div className={cn("mt-8 flex flex-wrap gap-3", centered && "justify-center")}>
          <CtaLink link={props.primary_cta} variant="accent" />
          <CtaLink link={props.secondary_cta} variant="outline" />
        </div>
      </Container>
    </div>
  );
}

export function RichText({ props }: { props: BlockProps<"rich_text"> }) {
  return (
    <Container className="max-w-3xl py-12">
      <RichHtml html={props.html} />
    </Container>
  );
}

export function ImageText({ props }: { props: BlockProps<"image_text"> }) {
  const imageFirst = props.image_position === "left";

  return (
    <Container className="py-16">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div className={cn(imageFirst && "md:order-2")}>
          {props.heading ? <h2 className="text-3xl font-semibold tracking-tight">{props.heading}</h2> : null}
          {props.html ? <RichHtml html={props.html} className="mt-4" /> : null}
          {props.cta ? <div className="mt-6"><CtaLink link={props.cta} /></div> : null}
        </div>
        <div className={cn("relative aspect-4/3 overflow-hidden rounded-lg bg-foreground/5", imageFirst && "md:order-1")}>
          <CmsImage media={props.image} fill sizes="(min-width: 768px) 50vw, 100vw" />
        </div>
      </div>
    </Container>
  );
}

const GALLERY_COLUMNS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

export function Gallery({ props }: { props: BlockProps<"gallery"> }) {
  return (
    <Container className="py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <ul className={cn("grid gap-4", GALLERY_COLUMNS[props.columns] ?? GALLERY_COLUMNS[3])}>
        {props.images.map((image, index) => (
          <li key={index}>
            <figure>
              <div className="relative aspect-4/3 overflow-hidden rounded-lg bg-foreground/5">
                <CmsImage media={image.media} fill sizes="(min-width: 1024px) 33vw, 50vw" />
              </div>
              {image.caption ? <figcaption className="mt-2 text-sm opacity-75">{image.caption}</figcaption> : null}
            </figure>
          </li>
        ))}
      </ul>
    </Container>
  );
}

const FEATURE_COLUMNS: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };

export function FeatureGrid({ props }: { props: BlockProps<"feature_grid"> }) {
  return (
    <Container className="py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <ul className={cn("grid gap-8", FEATURE_COLUMNS[props.columns] ?? FEATURE_COLUMNS[3])}>
        {props.items.map((item, index) => (
          <li key={index} className="flex gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <CmsIcon name={item.icon} className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold">{item.title}</h3>
              {item.text ? <p className="mt-1 text-sm opacity-80">{item.text}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </Container>
  );
}

export function Stats({ props }: { props: BlockProps<"stats"> }) {
  return (
    <Container className="py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <dl className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {props.items.map((item, index) => (
          <div key={index}>
            <dd className="text-4xl font-semibold text-brand">{item.value}</dd>
            <dt className="mt-1 text-sm opacity-75">{item.label}</dt>
          </div>
        ))}
      </dl>
    </Container>
  );
}

export function PricingTable({ props }: { props: BlockProps<"pricing_table"> }) {
  return (
    <Container className="py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <div className="grid gap-6 md:grid-cols-3">
        {props.plans.map((plan, index) => (
          <article key={index} className={cn("flex flex-col rounded-lg border p-6", plan.highlighted ? "border-brand shadow-lg ring-1 ring-brand" : "border-foreground/15")}>
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            {plan.price_label ? <p className="mt-2 text-3xl font-semibold">{plan.price_label}</p> : null}
            {plan.description ? <p className="mt-2 text-sm opacity-80">{plan.description}</p> : null}
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {plan.features.map((feature, i) => <li key={i}>{feature}</li>)}
            </ul>
            {plan.cta ? <div className="mt-6"><CtaLink link={plan.cta} variant={plan.highlighted ? "primary" : "outline"} /></div> : null}
          </article>
        ))}
      </div>
    </Container>
  );
}

export function Cta({ props }: { props: BlockProps<"cta"> }) {
  const tones = { brand: "bg-brand text-brand-foreground", dark: "bg-secondary text-white", light: "bg-foreground/5" } as const;

  return (
    <Container className="py-12">
      <div className={cn("rounded-xl px-6 py-12 text-center sm:px-12", tones[props.tone])}>
        <h2 className="text-3xl font-semibold tracking-tight text-balance">{props.heading}</h2>
        {props.text ? <p className="mx-auto mt-3 max-w-2xl text-lg opacity-90">{props.text}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <CtaLink link={props.primary} variant="accent" />
          <CtaLink link={props.secondary} variant="outline" />
        </div>
      </div>
    </Container>
  );
}

/**
 * Embeds only the hosts the API allows, in a sandboxed iframe, without loading the player until requested.
 */
export function Video({ props }: { props: BlockProps<"video"> }) {
  const embed = toEmbedUrl(props.url);

  if (!embed) {
    return null;
  }

  return (
    <Container className="max-w-4xl py-12">
      <div className="aspect-video overflow-hidden rounded-lg bg-black">
        <iframe
          src={embed} title={props.title} loading="lazy" className="size-full"
          sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin"
          allow="fullscreen; picture-in-picture" allowFullScreen
        />
      </div>
      {props.caption ? <p className="mt-2 text-sm opacity-75">{props.caption}</p> : null}
    </Container>
  );
}

function toEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const id = url.searchParams.get("v") ?? (url.pathname.startsWith("/embed/") ? url.pathname.slice(7) : null);

      return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.split("/").filter(Boolean).pop();

      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}?dnt=1` : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function LogoWall({ props }: { props: BlockProps<"logo_wall"> }) {
  return (
    <Container className="py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <ul className="grid grid-cols-2 items-center gap-8 sm:grid-cols-4 lg:grid-cols-6">
        {props.logos.map((logo, index) => (
          <li key={index} className="relative h-12">
            {logo.href ? (
              <CmsLink href={logo.href} aria-label={logo.name}><CmsImage media={logo.media} fill sizes="160px" className="object-contain" /></CmsLink>
            ) : (
              <CmsImage media={logo.media} fill sizes="160px" className="object-contain" />
            )}
          </li>
        ))}
      </ul>
    </Container>
  );
}

const SPACER = { sm: "h-4", md: "h-8", lg: "h-16", xl: "h-24" } as const;

export function Spacer({ props }: { props: BlockProps<"spacer"> }) {
  return <div aria-hidden className={SPACER[props.size]} />;
}

export function Divider({ props }: { props: BlockProps<"divider"> }) {
  return (
    <Container>
      <hr className={cn("border-foreground/20", props.line === "dotted" && "border-dotted")} />
    </Container>
  );
}
