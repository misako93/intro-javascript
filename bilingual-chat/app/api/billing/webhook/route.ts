import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { recordPartnerCommission, stripe, syncSubscription } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Webhook Stripe : met à jour la table "subscriptions".
 * Événements à activer dans Stripe : checkout.session.completed,
 * customer.subscription.created / updated / deleted, invoice.paid (commissions partenaires).
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Signature manquante" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch (err) {
    console.error("[stripe] signature invalide", err);
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe().subscriptions.retrieve(subId);
          await syncSubscription(admin, sub, session.client_reference_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(admin, event.data.object);
        break;
      case "invoice.paid":
        await recordPartnerCommission(admin, event.data.object);
        break;
    }
  } catch (err) {
    console.error(`[stripe] ${event.type}`, err);
    return NextResponse.json({ error: "Traitement impossible" }, { status: 500 }); // Stripe réessaiera
  }

  return NextResponse.json({ received: true });
}
