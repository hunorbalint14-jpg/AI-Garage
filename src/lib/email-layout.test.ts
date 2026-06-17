import { describe, it, expect } from "vitest";
import { renderEmail, emailDetails, emailButton, paragraphsToHtml } from "./email-layout";

const base = { brandName: "Smith Motors", bodyHtml: "<p>hi</p>", publicOrigin: "https://ai-garage.co.uk" };

describe("renderEmail", () => {
  it("wraps the body in a full HTML document with the dark shell", () => {
    const html = renderEmail(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("background:#0b0d11"); // page background
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("ai-garage.co.uk");
  });

  it("shows a wordmark when no logo, and an <img> when a logo is given", () => {
    expect(renderEmail(base)).toContain("Smith Motors");
    expect(renderEmail({ ...base, logoUrl: "https://x/logo.png" })).toContain('<img src="https://x/logo.png"');
  });

  it("renders heading, badge, details and cta when supplied", () => {
    const html = renderEmail({
      ...base,
      heading: "Booking confirmed",
      badge: "Confirmed",
      details: [{ label: "When", value: "Thu 18 Apr" }],
      cta: { url: "https://x/manage", label: "Manage booking" },
    });
    expect(html).toContain("Booking confirmed");
    expect(html).toContain("Confirmed");
    expect(html).toContain("When");
    expect(html).toContain("Thu 18 Apr");
    expect(html).toContain('href="https://x/manage"');
    expect(html).toContain("Manage booking");
  });

  it("falls back to the green accent for an invalid colour", () => {
    expect(renderEmail({ ...base, accentColor: "not-a-color", cta: { url: "u", label: "x" } })).toContain("#22c55e");
  });

  it("escapes user-controlled text", () => {
    const html = renderEmail({ ...base, brandName: "<script>", heading: "a & b" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });
});

describe("emailDetails", () => {
  it("is empty for no rows and renders label/value otherwise", () => {
    expect(emailDetails([])).toBe("");
    const out = emailDetails([{ label: "Where", value: "Camden\n12 High St" }]);
    expect(out).toContain("Where");
    expect(out).toContain("Camden<br>12 High St"); // newlines become <br>
  });
});

describe("emailButton", () => {
  it("uses the accent background and chooses legible text", () => {
    const dark = emailButton({ url: "u", label: "Go" }, "#0b0d11");
    expect(dark).toContain("#ffffff"); // white text on a dark accent
    const light = emailButton({ url: "u", label: "Go" }, "#e6e8eb");
    expect(light).toContain("#0b0d11"); // dark text on a light accent
  });
});

describe("paragraphsToHtml", () => {
  it("splits on blank lines and escapes", () => {
    const out = paragraphsToHtml("one\n\ntwo & three");
    expect(out.match(/<p /g)?.length).toBe(2);
    expect(out).toContain("two &amp; three");
  });
});
