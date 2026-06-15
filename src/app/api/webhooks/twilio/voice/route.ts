import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { sendSms } from "@/lib/sms";
import {
  validateTwilioSignature,
  parseTwilioAddress,
  routeInboundNumber,
  loadOrCreateConversation,
  appendMessages,
} from "@/lib/receptionist/inbound";
import type { TranscriptMessage } from "@/lib/receptionist/agent";

export const maxDuration = 30;

// Missed-call capture. The location's Twilio number rings the garage's real
// phone first (<Dial>); when nobody answers — or no forward number is set —
// the agent answers with a short message and texts the caller back, opening
// an SMS conversation the booking agent then runs.

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MISSED_SAY =
  "Sorry, we can't get to the phone right now. We're texting you back straight away so we can help — check your messages.";

async function startTextBack(routed: NonNullable<Awaited<ReturnType<typeof routeInboundNumber>>>, callerNumber: string) {
  const conversation = await loadOrCreateConversation({
    locationId: routed.locationId,
    customerPhone: callerNumber,
    channel: "sms",
    source: "missed_call",
  });
  if (!conversation) return;

  const opener = `Hi, it's ${routed.garageName} — sorry we missed your call! I can book you in or answer questions right here. What do you need?`;
  const sent = await sendSms({ to: callerNumber, body: opener, from: routed.twilioNumber });
  if (sent.success) {
    const message: TranscriptMessage = { role: "assistant", content: opener, at: new Date().toISOString() };
    await appendMessages(conversation.id, conversation.messages, [message]);
  }
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  if (
    !validateTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: request.url,
      params,
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const to = parseTwilioAddress(params.To ?? "");
  const from = parseTwilioAddress(params.From ?? "");
  const routed = to.number ? await routeInboundNumber(to.number) : null;

  if (!routed || !from.number) {
    return xml("<Response><Say>Sorry, this number is not in service.</Say><Hangup/></Response>");
  }

  const step = request.nextUrl.searchParams.get("step");

  // Step 2: the <Dial> attempt finished — anything but "completed" is a miss.
  if (step === "after-dial") {
    const dialStatus = params.DialCallStatus ?? "no-answer";
    if (dialStatus === "completed") return xml("<Response><Hangup/></Response>");
    after(() => startTextBack(routed, from.number));
    return xml(`<Response><Say voice="alice" language="en-GB">${escapeXml(MISSED_SAY)}</Say><Hangup/></Response>`);
  }

  // Step 1: try the garage's real phone first when one is configured.
  if (routed.forwardToPhone) {
    const action = `${request.nextUrl.origin}/api/webhooks/twilio/voice?step=after-dial`;
    return xml(
      `<Response><Dial timeout="${routed.forwardTimeoutSeconds}" action="${escapeXml(action)}">${escapeXml(routed.forwardToPhone)}</Dial></Response>`,
    );
  }

  // No forward number — go straight to text-back.
  after(() => startTextBack(routed, from.number));
  return xml(`<Response><Say voice="alice" language="en-GB">${escapeXml(MISSED_SAY)}</Say><Hangup/></Response>`);
}
