import type { ReactNode } from "react";
import { Container } from "@/components/blocks/shared";

export function AuthCard({ title, intro, children, footer, wide = false }: { title: string; intro?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Container className={wide ? "max-w-2xl py-12 sm:py-16" : "max-w-md py-12 sm:py-16"}>
      <h1 className="text-3xl font-semibold">{title}</h1>
      {intro ? <p className="mt-2 opacity-80">{intro}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 text-sm">{footer}</div> : null}
    </Container>
  );
}
