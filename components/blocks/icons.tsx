import { Box, Clock, Eye, FileText, Globe, Handshake, MapPin, Package, Plane, Shield, ShieldCheck, Ship, Truck, Warehouse, Zap, Circle, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  box: Box, clock: Clock, eye: Eye, "file-text": FileText, globe: Globe, handshake: Handshake,
  "map-pin": MapPin, package: Package, plane: Plane, shield: Shield, "shield-check": ShieldCheck,
  ship: Ship, truck: Truck, warehouse: Warehouse, zap: Zap,
};

/** CMS icon names are limited to this set so the icon bundle stays small. */
export function CmsIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Circle;

  return <Icon aria-hidden className={className} />;
}
