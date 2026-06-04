import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { generateInvoiceForPaidBooking } from "@/lib/booking-invoice";
import { pushPaymentToXero, pushPayoutToXero } from "@/lib/xero-sync";
import { applyQuoteDeposit } from "@/lib/quote-deposit";
import { applyStandaloneQuoteDeposit } from "@/app/quote/[slug]/actions";
import { recordRefundCreditNote, recomputeInvoiceRefundStatus } from "@/lib/credit-notes";
import { recordSubscriptionFromStripe } from "@/lib/service-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe Connect + invoice pay webhook handler. Verifies the signature
// against STRIPE_WEBHOOK_SECRET, then routes the event:
//
// - account.updated → keep our charges/payouts/details flags in sync
// - checkout.session.completed → mark the invoice paid (Checkout success)
// - payment_intent.succeeded → fallback for non-Checkout flows + the
//   destination charge of a Checkout session
// - charge.refunded → flip invoice back to "sent" if a refund happens
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  console.log("[stripe-webhook] event", { type: event.type, id: event.id });

  // Idempotency: claim this event id before any work. Stripe delivers events
  // at-least-once (retries + occasional duplicates), so a repeat delivery hits
  // the PK conflict and is acknowledged without re-running side effects that
  // aren't themselves idempotent (Xero payment/payout pushes, booking-invoice
  // generation + email).
  const { error: claimErr } = await admin
    .from("stripe_webhook_events")
    .insert({ id: event.id, type: event.type });
  if (claimErr) {
    if (claimErr.code === "23505") {
      console.log("[stripe-webhook] duplicate event ignored", { id: event.id, type: event.type });
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Fail open on any other claim error so a transient table issue doesn't
    // drop a real payment event — the handlers below are mostly idempotent.
    console.error("[stripe-webhook] idempotency claim failed (continuing)", {
      id: event.id,
      error: claimErr.message,
    });
  }

  try {
    await handleStripeEvent(admin, event);
  } catch (err) {
    // Processing threw — release the claim so Stripe's retry reprocesses it.
    console.error("[stripe-webhook] processing failed; releasing claim for retry", {
      id: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await admin.from("stripe_webhook_events").delete().eq("id", event.id);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  await admin
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", event.id);

  return NextResponse.json({ received: true });
}

// Routes a verified, de-duplicated Stripe event to its side effects. Throwing
// here releases the idempotency claim (see POST) so Stripe's retry reprocesses.
async function handleStripeEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
) {
  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const { error, count } = await admin
        .from("organizations")
        .update(
          {
            stripe_charges_enabled: !!account.charges_enabled,
            stripe_payouts_enabled: !!account.payouts_enabled,
            stripe_details_submitted: !!account.details_submitted,
          },
          { count: "exact" },
        )
        .eq("stripe_account_id", account.id);
      console.log("[stripe-webhook] account.updated", {
        accountId: account.id,
        rowsUpdated: count,
        error: error?.message,
      });
      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Service-plan subscriptions: created on the connected account, so the
      // event carries event.account. Retrieve the subscription and record it.
      if (session.metadata?.kind === "service_plan" && session.subscription) {
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        if (event.account) {
          const sub = await stripe.subscriptions.retrieve(subId, undefined, {
            stripeAccount: event.account,
          });
          await recordSubscriptionFromStripe(admin, sub);
          console.log("[stripe-webhook] service_plan subscription recorded", { subId });
        } else {
          console.error("[stripe-webhook] service_plan checkout missing event.account", { subId });
        }
        break;
      }

      const invoiceId = session.metadata?.invoice_id;
      const bookingId = session.metadata?.booking_id;
      const quoteId = session.metadata?.quote_id;
      const standaloneQuoteId = session.metadata?.standalone_quote_id;
      const paid = session.payment_status === "paid";
      if (!paid) break;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

      if (quoteId) {
        await applyQuoteDeposit({
          quoteId,
          paymentIntentId,
          checkoutSessionId: session.id,
          amountPence: session.amount_total ?? 0,
        });
      }

      if (standaloneQuoteId) {
        await applyStandaloneQuoteDeposit({
          quoteId: standaloneQuoteId,
          paymentIntentId,
          checkoutSessionId: session.id,
          amountPence: session.amount_total ?? 0,
        });
      }

      if (invoiceId) {
        const { error, count } = await admin
          .from("invoices")
          .update(
            {
              status: "paid",
              paid_at: new Date().toISOString(),
              stripe_paid_at: new Date().toISOString(),
              stripe_paid_amount_pence: session.amount_total ?? null,
              stripe_payment_intent_id: paymentIntentId,
              stripe_checkout_session_id: session.id,
            },
            { count: "exact" },
          )
          .eq("id", invoiceId);
        console.log("[stripe-webhook] checkout.session.completed invoice", {
          invoiceId,
          rowsUpdated: count,
          error: error?.message,
        });

        // Push payment to Xero so the invoice is marked paid there too.
        if (count && count > 0) {
          try {
            await pushPaymentToXero({
              invoiceId,
              amountPence: session.amount_total ?? 0,
              paymentDate: new Date().toISOString(),
              reference: paymentIntentId ?? `Checkout ${session.id}`,
            });
          } catch (err) {
            console.error("[stripe-webhook] xero payment push failed", err);
          }
        }
      }

      if (bookingId) {
        const { error, count } = await admin
          .from("bookings")
          .update(
            {
              status: "scheduled",
              paid_at: new Date().toISOString(),
              paid_amount_pence: session.amount_total ?? null,
              stripe_payment_intent_id: paymentIntentId,
              stripe_checkout_session_id: session.id,
            },
            { count: "exact" },
          )
          .eq("id", bookingId);
        console.log("[stripe-webhook] checkout.session.completed booking", {
          bookingId,
          rowsUpdated: count,
          error: error?.message,
        });

        // Generate + email the branded paid invoice for the booking.
        if (count && count > 0) {
          try {
            await generateInvoiceForPaidBooking({
              bookingId,
              amountPence: session.amount_total ?? 0,
              stripePaymentIntentId: paymentIntentId,
              stripeCheckoutSessionId: session.id,
            });
          } catch (err) {
            console.error("[stripe-webhook] booking invoice generation failed", err);
          }
        }
      }
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const invoiceId = pi.metadata?.invoice_id;
      const bookingId = pi.metadata?.booking_id;
      if (invoiceId) {
        const { count } = await admin
          .from("invoices")
          .update(
            {
              status: "paid",
              paid_at: new Date().toISOString(),
              stripe_paid_at: new Date().toISOString(),
              stripe_paid_amount_pence: pi.amount_received ?? pi.amount ?? null,
              stripe_payment_intent_id: pi.id,
            },
            { count: "exact" },
          )
          .eq("id", invoiceId)
          .neq("status", "paid");
        console.log("[stripe-webhook] payment_intent.succeeded invoice", {
          invoiceId,
          rowsUpdated: count,
        });
      }
      if (bookingId) {
        const { count } = await admin
          .from("bookings")
          .update(
            {
              status: "scheduled",
              paid_at: new Date().toISOString(),
              paid_amount_pence: pi.amount_received ?? pi.amount ?? null,
              stripe_payment_intent_id: pi.id,
            },
            { count: "exact" },
          )
          .eq("id", bookingId)
          .is("paid_at", null);
        console.log("[stripe-webhook] payment_intent.succeeded booking", {
          bookingId,
          rowsUpdated: count,
        });
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (!pi) break;

      const { data: inv } = await admin
        .from("invoices")
        .select("id, location_id, customer_id, vat_rate")
        .eq("stripe_payment_intent_id", pi)
        .maybeSingle();
      if (!inv) {
        console.log("[stripe-webhook] charge.refunded — no matching invoice", { pi });
        break;
      }
      const invRow = inv as { id: string; location_id: string; customer_id: string | null; vat_rate: number };

      // Record each Stripe refund as a credit note (idempotent on
      // stripe_refund_id, so an in-app refund the staff action already wrote
      // isn't duplicated). Covers refunds initiated in the Stripe dashboard too.
      const refunds = charge.refunds?.data ?? [];
      for (const r of refunds) {
        await recordRefundCreditNote(admin, {
          invoiceId: invRow.id,
          locationId: invRow.location_id,
          customerId: invRow.customer_id,
          grossPence: r.amount,
          vatRate: Number(invRow.vat_rate) || 0,
          reason: "Stripe refund",
          stripeRefundId: r.id,
          createdBy: null,
        });
      }
      // Fallback when the refund list isn't expanded on the event.
      if (refunds.length === 0 && (charge.amount_refunded ?? 0) > 0) {
        await recordRefundCreditNote(admin, {
          invoiceId: invRow.id,
          locationId: invRow.location_id,
          customerId: invRow.customer_id,
          grossPence: charge.amount_refunded,
          vatRate: Number(invRow.vat_rate) || 0,
          reason: "Stripe refund",
          stripeRefundId: `charge_${charge.id}`,
          createdBy: null,
        });
      }

      await recomputeInvoiceRefundStatus(admin, invRow.id);
      console.log("[stripe-webhook] charge.refunded reconciled", { pi, invoiceId: invRow.id });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Service-plan lifecycle on the connected account — keep our
      // plan_subscriptions row's status / period / cancel flag in sync.
      const sub = event.data.object as Stripe.Subscription;
      await recordSubscriptionFromStripe(admin, sub);
      console.log("[stripe-webhook] subscription synced", {
        id: sub.id,
        status: sub.status,
        type: event.type,
      });
      break;
    }

    case "payout.paid": {
      // Fires on the connected account when Stripe pays the garage's
      // balance out to their real bank. We post a matching Receive Money
      // bank transaction to their Xero so their accountant can reconcile.
      const payout = event.data.object as Stripe.Payout;
      const stripeAccountId = event.account;
      if (!stripeAccountId) {
        console.log("[stripe-webhook] payout.paid missing account", { id: payout.id });
        break;
      }
      const arrivalDate = new Date(payout.arrival_date * 1000)
        .toISOString()
        .split("T")[0];
      try {
        await pushPayoutToXero({
          stripePayoutId: payout.id,
          stripeAccountId,
          amountPence: payout.amount,
          arrivalDate,
        });
      } catch (err) {
        console.error("[stripe-webhook] payout.paid xero push failed", err);
      }
      break;
    }
  }
}
