import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderBlocks } from "@/components/blocks/render-blocks";
import type { BlockEnvelope } from "@/lib/cms/schemas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const block = (type: string, props: Record<string, unknown>, extra: Partial<BlockEnvelope> = {}): BlockEnvelope => ({
  id: `${type}-1`, type, props,
  visibility: { mobile: true, tablet: true, desktop: true }, style: { background: "none" }, anchor: null, ...extra,
});

afterEach(() => vi.unstubAllEnvs());

describe("RenderBlocks", () => {
  it("renders a hero with its headline as the page h1 and CTA links", () => {
    render(<RenderBlocks blocks={[block("hero", { headline: "Ship anywhere", primary_cta: { label: "Get a quote", href: "/quote" } })]} />);

    expect(screen.getByRole("heading", { level: 1, name: "Ship anywhere" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a quote" })).toHaveAttribute("href", "/quote");
  });

  it("shows the tracking form inside a hero when enabled", () => {
    render(<RenderBlocks blocks={[block("hero", { headline: "H", show_tracking: true })]} />);

    expect(screen.getByLabelText("Tracking number")).toBeInTheDocument();
  });

  it("skips unknown block types instead of rendering raw data", () => {
    const { container } = render(<RenderBlocks blocks={[block("script", { src: "https://evil.test/x.js" })]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("skips blocks whose props fail validation and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<RenderBlocks blocks={[block("hero", {}), block("rich_text", { html: "<p>still here</p>" })]} />);

    expect(screen.getByText("still here")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("applies responsive visibility classes", () => {
    const { container } = render(
      <RenderBlocks blocks={[block("rich_text", { html: "<p>x</p>" }, { visibility: { mobile: false, tablet: true, desktop: false } })]} />,
    );
    const section = container.querySelector("section");

    expect(section).toHaveClass("max-md:hidden", "lg:hidden");
    expect(section).not.toHaveClass("md:max-lg:hidden");
  });

  it("applies background style and anchor id", () => {
    const { container } = render(
      <RenderBlocks blocks={[block("spacer", { size: "md" }, { style: { background: "dark" }, anchor: "pricing" })]} />,
    );
    const section = container.querySelector("section");

    expect(section).toHaveAttribute("id", "pricing");
    expect(section).toHaveClass("bg-secondary");
  });

  it("renders FAQ answers and toggles them", async () => {
    render(<RenderBlocks blocks={[block("faq", { heading: "FAQ", items: [{ question: "How do I track?", answer_html: "<p>Use the box.</p>" }] })]} />);
    const trigger = screen.getByRole("button", { name: "How do I track?" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Use the box.")).toBeVisible();
  });

  it("renders feature items with a known icon and falls back for unknown names", () => {
    render(<RenderBlocks blocks={[block("feature_grid", { items: [{ icon: "plane", title: "Air" }, { icon: "nonsense", title: "Other" }] })]} />);

    expect(screen.getByRole("heading", { level: 3, name: "Air" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Other" })).toBeInTheDocument();
  });

  it("only embeds allow-listed video hosts, in a sandboxed iframe", () => {
    const { container, rerender } = render(<RenderBlocks blocks={[block("video", { url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Intro" })]} />);
    const frame = container.querySelector("iframe");

    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(frame).toHaveAttribute("sandbox");

    rerender(<RenderBlocks blocks={[block("video", { url: "https://evil.test/embed/x", title: "Bad" })]} />);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders nothing in production for blocks awaiting a backend module", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<RenderBlocks blocks={[block("quote_widget", {}), block("service_cards", {}), block("contact_form", {})]} />);

    expect(screen.queryByText(/waiting for/)).not.toBeInTheDocument();
  });

  it("names the missing module in development", () => {
    render(<RenderBlocks blocks={[block("quote_widget", {})]} />);

    expect(screen.getByText(/waiting for the quotation API/)).toBeInTheDocument();
  });

  it("renders API-sanitised rich text as markup", () => {
    render(<RenderBlocks blocks={[block("rich_text", { html: "<p>Hello <strong>world</strong></p>" })]} />);

    expect(screen.getByText("world").tagName).toBe("STRONG");
  });
});
