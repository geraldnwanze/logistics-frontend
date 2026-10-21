import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaClient } from "@/components/site/pwa";

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
}

function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });

  return event;
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => localStorage.clear());

describe("PwaClient", () => {
  it("shows nothing while online with nothing to offer", () => {
    const { container } = render(<PwaClient />);

    expect(container).toBeEmptyDOMElement();
  });

  it("tells the visitor when they go offline and clears the notice when they return", () => {
    render(<PwaClient />);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/offline.*may be out of date/i);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers installation, triggers the browser prompt, and hides the offer afterwards", async () => {
    render(<PwaClient />);
    const event = installPromptEvent("accepted");

    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Install" })));

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(localStorage.getItem("pwa-install-dismissed")).toBeNull();
  });

  it("remembers when the visitor declines and does not ask again", () => {
    const first = render(<PwaClient />);
    act(() => void window.dispatchEvent(installPromptEvent("accepted")));

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(localStorage.getItem("pwa-install-dismissed")).toBe("1");
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();

    first.unmount();
    render(<PwaClient />);
    act(() => void window.dispatchEvent(installPromptEvent("accepted")));
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("still offers installation when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<PwaClient />);

    act(() => void window.dispatchEvent(installPromptEvent("accepted")));
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("hides the install offer while offline", () => {
    render(<PwaClient />);
    act(() => {
      window.dispatchEvent(installPromptEvent("accepted"));
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });
});
