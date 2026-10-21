import { describe, expect, it } from "vitest";
import { cn, isExternalHref, isSafeHref } from "@/lib/utils";

describe("isSafeHref", () => {
  it.each(["/quote", "/a/b?x=1#y", "#section", "https://example.com/a", "http://example.com", "mailto:a@b.co", "tel:+2348012345678"])(
    "accepts %s", (href) => expect(isSafeHref(href)).toBe(true),
  );

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,AA==", "//evil.test/x", "ftp://host/f", "", "/ok\nSet-Cookie: x", " /leading-space"])(
    "rejects %j", (href) => expect(isSafeHref(href)).toBe(false),
  );
});

describe("isExternalHref", () => {
  it("separates external from internal links", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("mailto:a@b.co")).toBe(true);
    expect(isExternalHref("/about")).toBe(false);
    expect(isExternalHref("#top")).toBe(false);
  });
});

describe("cn", () => {
  it("merges and de-duplicates tailwind classes", () => {
    expect(cn("px-2", false, "px-4", undefined, "text-sm")).toBe("px-4 text-sm");
  });
});
