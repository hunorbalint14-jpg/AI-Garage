import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ResendEvent = {
  type: string;
  data: { email_id: string };
};

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
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
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const emailId = event.data.email_id;
  if (!emailId) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  const now = new Date().toISOString();

  switch (event.type) {
    case "email.opened":
      await admin
        .from("reminders")
        .update({ opened_at: now })
        .eq("resend_email_id", emailId)
        .is("opened_at", null);
      break;
    case "email.clicked":
      await admin
        .from("reminders")
        .update({ clicked_at: now })
        .eq("resend_email_id", emailId)
        .is("clicked_at", null);
      break;
    case "email.delivered":
      await admin
        .from("reminders")
        .update({ delivered_at: now })
        .eq("resend_email_id", emailId);
      break;
    case "email.bounced":
      await admin
        .from("reminders")
        .update({ status: "bounced" })
        .eq("resend_email_id", emailId);
      break;
  }

  return NextResponse.json({ received: true });
}
