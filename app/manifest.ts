import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/cms/api";

/** Install metadata follows the CMS branding, so renaming the business or changing its colour needs no deploy. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  const name = settings?.general.business_name ?? "Logistics";

  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trimEnd() : name,
    description: settings?.general.tagline ?? "Ship, track and manage deliveries.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: settings?.branding.primary_color ?? "#0B3C6F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Track a shipment", short_name: "Track", url: "/track" }],
  };
}
