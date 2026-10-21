import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingForm } from "@/components/blocks/tracking-widget";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());

describe("TrackingForm", () => {
  it("navigates to the tracking page with an encoded number", async () => {
    render(<TrackingForm />);

    await userEvent.type(screen.getByLabelText("Tracking number"), "  LG-1234ABCD  ");
    await userEvent.click(screen.getByRole("button", { name: /track/i }));

    expect(push).toHaveBeenCalledWith("/track/LG-1234ABCD");
  });

  it.each(["", "abc", "has space inside", "<script>alert(1)</script>", "../../etc/passwd"])("rejects %j with an accessible error", async (value) => {
    render(<TrackingForm />);

    if (value) {
      await userEvent.type(screen.getByLabelText("Tracking number"), value);
    }
    await userEvent.click(screen.getByRole("button", { name: /track/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/6–40/);
    expect(screen.getByLabelText("Tracking number")).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
  });

  it("submits with the Enter key", async () => {
    render(<TrackingForm />);

    await userEvent.type(screen.getByLabelText("Tracking number"), "ABC12345{Enter}");

    expect(push).toHaveBeenCalledWith("/track/ABC12345");
  });

  it("clears a previous error after a valid submission", async () => {
    render(<TrackingForm />);
    const input = screen.getByLabelText("Tracking number");

    await userEvent.type(input, "x{Enter}");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "VALID-12345{Enter}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
