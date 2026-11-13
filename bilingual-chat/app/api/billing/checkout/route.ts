import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { BILLING_ENABLED } from "@/lib/billing";
import { safeNext } from "@/lib/utils";

/** Formulaire POST → redirection vers la page de paiement Stripe. */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const form = await request.formData().catch(() => null);
  const returnTo = safeNext(form?.get("returnTo")?.toString());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(returnTo)}`, 303);
  if (!BILLING_ENABLED) return NextResponse.redirect(`${origin}${returnTo}`, 303);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  // Déjà abonné → espace de gestion Stripe plutôt qu'un 2e abonnement.
  if (existing?.stripe_customer_id && ["active", "trialing", "past_due"].includes(existing.status)) {
    const portal = await stripe().billingPortal.sessions.create({
      customer: existing.stripe_customer_id,
      return_url: `${origin}${returnTo}`,
    });
    return NextResponse.redirect(portal.url, 303);
  }

  let customerId = existing?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({ email: user.email, metadata: { user_id: user.id } });
    customerId = customer.id;
    await createAdminClient()
      .from("subscriptions")
      .upsert({ user_id: user.id, stripe_customer_id: customerId, status: "inactive" });
  }

  const sep = returnTo.includes("?") ? "&" : "?";
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    success_url: `${origin}${returnTo}${sep}checkout=success`,
    cancel_url: `${origin}${returnTo}`,
  });

  return NextResponse.redirect(session.url!, 303);
}
