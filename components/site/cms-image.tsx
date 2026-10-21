import Image from "next/image";
import type { Media } from "@/lib/cms/schemas";
import { cn } from "@/lib/utils";

type CmsImageProps = {
  media: Media;
  className?: string;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
};

/**
 * Renders a resolved CMS media reference. Returns nothing when the asset is
 * missing (deleted, or private) so pages degrade instead of showing broken images.
 */
export function CmsImage({ media, className, sizes = "100vw", priority = false, fill = false }: CmsImageProps) {
  if (!media?.url) {
    return null;
  }

  const unoptimized = process.env.NODE_ENV !== "production";
  const alt = media.alt ?? "";

  if (fill || !media.width || !media.height) {
    return <Image src={media.url} alt={alt} fill sizes={sizes} className={cn("object-cover", className)} priority={priority} unoptimized={unoptimized} />;
  }

  return (
    <Image
      src={media.url} alt={alt} width={media.width} height={media.height} sizes={sizes}
      className={className} priority={priority} unoptimized={unoptimized}
    />
  );
}
