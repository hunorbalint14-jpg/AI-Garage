import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendSms } from "./sms";

describe("sendSms", () => {
  const origSid = process.env.TWILIO_ACCOUNT_SID;
  const origToken = process.env.TWILIO_AUTH_TOKEN;
  const origFrom = process.env.TWILIO_FROM_NUMBER;

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = origSid;
    process.env.TWILIO_AUTH_TOKEN = origToken;
    process.env.TWILIO_FROM_NUMBER = origFrom;
  });

  it("returns Twilio-not-configured error when env missing", async () => {
    const res = await sendSms({ to: "+447000000000", body: "hi" });
    expect(res).toEqual({ success: false, error: "Twilio not configured." });
  });
});
