import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";

// The route reaches the DB only after a payload is verified AND parsed, so the
// admin client doubles as the assertion that we got that far: every `.from()`
// chain is a self-returning stub that records the table it was called on.
const touchedTables: string[] = [];
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["update", "eq", "is", "insert", "upsert", "select"]) {
    c[m] = vi.fn(() => c);
  }
  // `await`-ing the builder resolves like a PostgREST response.
  c.then = (resolve: (v: unknown) => unknown) => resolve({ count: 1, error: null });
  return c;
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      touchedTables.push(table);
      return chain();
    }),
  })),
}));
vi.mock("@/lib/platform/webhooks", () => ({ recordWebhookDelivery: vi.fn() }));
vi.mock("@/lib/email-suppression", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email-suppression")>()),
  suppressEmails: vi.fn(),
}));

const { suppressEmails } = await import("@/lib/email-suppression");
const { POST } = await import("./route");

// A valid svix secret is base64 after the `whsec_` prefix.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

// Build a request whose signature svix will actually accept, using svix's own
// signer. This is what pins the regression: svix v2's `verify()` returns
// `undefined` instead of the parsed payload, so a route that trusts its return
// value gets `undefined` and blows up on the first property access.
function signedRequest(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  const id = "msg_2abc";
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, body);
  return new Request("https://ai-garage.co.uk/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
    body,
  });
}

describe("resend webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    touchedTables.length = 0;
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });

  it("verifies the signature and parses the event body", async () => {
    const req = signedRequest({ type: "email.delivered", data: { email_id: "em_1" } });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    // Proof the parsed event survived: the route only reaches `reminders` by
    // switching on `event.type`, which would throw if `event` were undefined.
    expect(touchedTables).toContain("reminders");
  });

  it("suppresses the recipient on a hard bounce", async () => {
    const req = signedRequest({
      type: "email.bounced",
      data: { email_id: "em_2", bounce: { type: "Permanent" }, to: ["dead@example.com"] },
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(suppressEmails).toHaveBeenCalledOnce();
  });

  it("rejects a payload signed with a different secret", async () => {
    const req = signedRequest(
      { type: "email.delivered", data: { email_id: "em_3" } },
      "whsec_Zm9yZ2VkLXNlY3JldC1ub3Qtb3Vycy1hdC1hbGw=",
    );

    const res = await POST(req as never);

    expect(res.status).toBe(400);
    expect(touchedTables).toHaveLength(0);
  });

  it("rejects a body that is not valid JSON", async () => {
    const body = "not json";
    const id = "msg_2def";
    const timestamp = new Date();
    const req = new Request("https://ai-garage.co.uk/api/webhooks/resend", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": new Webhook(SECRET).sign(id, timestamp, body),
      },
      body,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(400);
    expect(touchedTables).toHaveLength(0);
  });

  it("500s when the webhook secret is not configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    const res = await POST(signedRequest({ type: "email.delivered", data: { email_id: "em_4" } }) as never);

    expect(res.status).toBe(500);
  });
});
