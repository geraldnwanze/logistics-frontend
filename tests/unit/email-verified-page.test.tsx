import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmailVerifiedPage, { metadata } from "@/app/email-verified/page";

describe("email verified page", () => {
  it("confirms the address and leads to the account", () => {
    render(<EmailVerifiedPage />);

    expect(screen.getByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your account" })).toHaveAttribute("href", "/account");
  });

  it("is kept out of search results", () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
