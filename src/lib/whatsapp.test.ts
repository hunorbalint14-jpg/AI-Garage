import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendWhatsApp } from "./whatsapp";

describe("sendWhatsApp", () => {
  const orig = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM,
  };

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;
  });

  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = orig.sid;
    process.env.TWILIO_AUTH_TOKEN = orig.token;
    process.env.TWILIO_WHATSAPP_FROM = orig.from;
  });

  it("returns not-configured error when env missing", async () => {
    const res = await sendWhatsApp({ to: "+447000000000", body: "hi" });
    expect(res.success).toBe(false);
  });
});
