import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordWebhookDelivery } from "@/lib/platform/webhooks";


type ResendEvent = {
  type: string;
  data: { email_id: string };
};

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const body = await request.text();
  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: ResendEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, svixHeaders) as ResendEvent;
  } catch (err) {
    console.error("[resend-webhook] signature verification failed", {
      message: err instanceof Error ? err.message : String(err),
      hasSvixId: !!svixHeaders["svix-id"],
      hasSignature: !!svixHeaders["svix-signature"],
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const emailId = event.data.email_id;
  console.log("[resend-webhook] event", { type: event.type, emailId });
  if (!emailId) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  const now = new Date().toISOString();

  let updated: { count: number | null } = { count: null };
  switch (event.type) {
    case "email.opened":
      updated = await admin
        .from("reminders")
        .update({ opened_at: now }, { count: "exact" })
        .eq("resend_email_id", emailId)
        .is("opened_at", null);
      break;
    case "email.clicked":
      updated = await admin
        .from("reminders")
        .update({ clicked_at: now }, { count: "exact" })
        .eq("resend_email_id", emailId)
        .is("clicked_at", null);
      break;
    case "email.delivered":
      updated = await admin
        .from("reminders")
        .update({ delivered_at: now }, { count: "exact" })
        .eq("resend_email_id", emailId);
      break;
    case "email.bounced":
      updated = await admin
        .from("reminders")
        .update({ status: "bounced" }, { count: "exact" })
        .eq("resend_email_id", emailId);
      break;
  }
  console.log("[resend-webhook] update result", {
    type: event.type,
    emailId,
    rowsUpdated: updated.count,
  });

  await recordWebhookDelivery(admin, { provider: "resend", eventType: event.type, ok: true, statusCode: 200 });

  return NextResponse.json({ received: true });
}
