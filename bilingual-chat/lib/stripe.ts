import Stripe from "stripe";

let client: Stripe | null = null;

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY manquante");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** Enregistre l'état d'un abonnement Stripe dans Supabase. */
export async function syncSubscription(
  admin: import("@supabase/supabase-js").SupabaseClient,
  sub: Stripe.Subscription,
  userIdHint?: string | null,
) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  let userId = userIdHint || sub.metadata?.user_id || null;

  if (!userId) {
    const { data } = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) throw new Error(`Utilisateur introuvable pour le client Stripe ${customerId}`);

  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? null;

  const { error } = await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: item?.price?.id ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
