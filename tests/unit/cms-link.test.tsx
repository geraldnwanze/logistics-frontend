import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CmsLink } from "@/components/site/cms-link";

describe("CmsLink", () => {
  it("renders internal paths as links", () => {
    render(<CmsLink href="/about-us">About</CmsLink>);

    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about-us");
  });

  it("opens external https links safely in a new tab", () => {
    render(<CmsLink href="https://example.com">Partner</CmsLink>);
    const link = screen.getByRole("link", { name: "Partner" });

    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not add target to mailto links", () => {
    render(<CmsLink href="mailto:help@example.com">Email</CmsLink>);

    expect(screen.getByRole("link", { name: "Email" })).not.toHaveAttribute("target");
  });

  it.each(["javascript:alert(1)", "//evil.test", "data:text/html,x"])("renders %s as inert text, never a link", (href) => {
    render(<CmsLink href={href}>Click me</CmsLink>);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });
});
