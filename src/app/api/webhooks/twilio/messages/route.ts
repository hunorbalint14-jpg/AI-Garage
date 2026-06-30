import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { runReceptionistTurn, type TranscriptMessage } from "@/lib/receptionist/agent";
import {
  validateTwilioSignature,
  parseTwilioAddress,
  routeInboundNumber,
  loadOrCreateConversation,
  appendMessages,
  TRANSCRIPT_MODEL_WINDOW,
} from "@/lib/receptionist/inbound";

export const runtime = "nodejs";
export const maxDuration = 60;

// Inbound SMS/WhatsApp for the AI receptionist. Twilio expects a response
// within ~15s and a multi-tool agent turn can take longer, so we ack with
// empty TwiML immediately and run the agent in after(), replying over the
// REST API from the location's own number.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(body: string = EMPTY_TWIML) {
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml" } });
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
  const body = (params.Body ?? "").trim();
  if (!to.number || !from.number || !body) return twiml();

  const routed = await routeInboundNumber(to.number);
  if (!routed) return twiml(); // unknown number / disabled / not entitled — stay silent

  const conversation = await loadOrCreateConversation({
    locationId: routed.locationId,
    customerPhone: from.number,
    channel: from.channel,
    source: "inbound_message",
  });
  if (!conversation) return twiml();

  // Ack Twilio now; think and reply after the response is sent.
  after(async () => {
    const userMessage: TranscriptMessage = {
      role: "user",
      content: body.slice(0, 1000),
      at: new Date().toISOString(),
    };
    const transcript = [...conversation.messages, userMessage];

    try {
      const result = await runReceptionistTurn(transcript.slice(-TRANSCRIPT_MODEL_WINDOW), {
        locationId: routed.locationId,
        organizationId: routed.organizationId,
        garageName: routed.garageName,
        locationName: routed.locationName,
        weekly: routed.weekly,
        specialHours: routed.specialHours,
        conversationId: conversation.id,
        customerPhone: from.number,
        channel: from.channel,
      });

      const reply: TranscriptMessage = {
        role: "assistant",
        content: result.reply,
        at: new Date().toISOString(),
      };
      await appendMessages(conversation.id, conversation.messages, [userMessage, reply]);

      if (from.channel === "whatsapp") {
        await sendWhatsApp({
          to: from.number,
          body: result.reply,
          from: `whatsapp:${routed.twilioNumber}`,
        });
      } else {
        await sendSms({ to: from.number, body: result.reply, from: routed.twilioNumber });
      }
    } catch (err) {
      console.error("[receptionist] agent turn failed", err);
      await appendMessages(conversation.id, conversation.messages, [userMessage]);
      const apology =
        "Sorry — something went wrong on our side. The garage will get back to you shortly.";
      if (from.channel === "whatsapp") {
        await sendWhatsApp({ to: from.number, body: apology, from: `whatsapp:${routed.twilioNumber}` });
      } else {
        await sendSms({ to: from.number, body: apology, from: routed.twilioNumber });
      }
    }
  });

  return twiml();
}
