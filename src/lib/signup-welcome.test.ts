import { describe, it, expect, vi, beforeEach } from "vitest";

// email.ts pulls in Resend + env, so mock it; email-layout.ts is pure and used
// for real (it builds the body HTML the welcome assembles).
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: "m_1" })),
  tenantBookingUrl: vi.fn((_slug: string, path: string) => `https://smith.example${path}`),
  renderPlatformEmail: vi.fn(() => "<html>welcome</html>"),
  paragraphsToHtml: vi.fn((t: string) => `<p>${t}</p>`),
}));

const { sendEmail } = await import("@/lib/email");
const { sendOrgWelcomeEmail } = await import("./signup-welcome");

const input = {
  ownerName: "Sam Smith",
  email: "owner@smith.example",
  orgName: "Smith Motors",
  slug: "smith-motors",
};

beforeEach(() => vi.clearAllMocks());

describe("sendOrgWelcomeEmail", () => {
  it("emails the owner a welcome with the garage-scoped links", async () => {
    await sendOrgWelcomeEmail(input);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendEmail).mock.calls[0][0];
    expect(arg).toMatchObject({ to: "owner@smith.example", html: "<html>welcome</html>" });
    expect(arg.subject).toContain("Smith Motors");
    // Sign-in deep-link, pre-filled with the owner's (url-encoded) email.
    expect(arg.text).toContain("https://smith.example/staff/login?email=owner%40smith.example");
    // Getting-started steps + booking page + the plans link.
    expect(arg.text).toContain("https://smith.example/staff/onboarding");
    expect(arg.text).toContain("https://smith.example/book");
    expect(arg.text).toContain("https://smith.example/staff/settings/billing");
  });

  it("logs (does not throw) when delivery fails", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: "Resend rejected" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendOrgWelcomeEmail(input)).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      "[welcome] org: sendEmail failed",
      expect.objectContaining({ to: "owner@smith.example", slug: "smith-motors", error: "Resend rejected" }),
    );
    errSpy.mockRestore();
  });
});
