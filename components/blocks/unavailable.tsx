import { Container } from "./shared";

/**
 * Blocks that need a backend module which doesn't exist yet. Production renders nothing
 * (no fake content); development shows which block is waiting for what.
 */
export function Unavailable({ type, needs }: { type: string; needs: string }) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <Container className="py-6">
      <p className="rounded-md border border-dashed border-foreground/30 p-4 text-sm opacity-70">
        <code>{type}</code> block is waiting for {needs}; nothing is rendered in production.
      </p>
    </Container>
  );
}
