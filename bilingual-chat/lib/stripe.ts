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
    plan_amount: item?.price?.unit_amount ?? null,
    plan_currency: item?.price?.currency ?? null,
    plan_interval: item?.price?.recurring?.interval ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * Relit le compte Stripe Connect d'un partenaire (versements possibles ? quelle banque ?)
 * et l'enregistre. Le RIB lui-même reste chez Stripe : on ne garde que "Banque ···· 1234".
 */
export async function refreshPartnerAccount(
  admin: import("@supabase/supabase-js").SupabaseClient,
  partnerId: string,
  accountId: string,
) {
  const acct = await stripe().accounts.retrieve(accountId);
  const ext = acct.external_accounts?.data?.[0];
  const bankLabel = ext
    ? `${ext.object === "bank_account" ? ext.bank_name || "Compte bancaire" : "Carte"} ···· ${ext.last4}`
    : null;
  const payoutsEnabled = Boolean(acct.payouts_enabled);
  await admin.from("partners").update({ payouts_enabled: payoutsEnabled, bank_label: bankLabel }).eq("user_id", partnerId);
  return { payoutsEnabled, bankLabel, detailsSubmitted: Boolean(acct.details_submitted) };
}

/**
 * Facture payée par un hôtel relié à un partenaire → commission "à recevoir".
 * Idempotent : une seule commission par facture, même si Stripe renvoie l'événement.
 */
export async function recordPartnerCommission(
  admin: import("@supabase/supabase-js").SupabaseClient,
  invoice: Stripe.Invoice,
) {
  const base = invoice.total_excluding_tax ?? invoice.amount_paid; // hors taxes
  if (!invoice.id || !invoice.customer || base <= 0) return;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;

  const { data: sub } = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (!sub) return;
  const { data: hotel } = await admin
    .from("hotels")
    .select("id, name, partner_id, partners(commission_percent)")
    .eq("owner_id", sub.user_id)
    .not("partner_id", "is", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!hotel?.partner_id) return;

  const percent = Number((hotel.partners as unknown as { commission_percent: number } | null)?.commission_percent ?? 0);
  const amount = Math.round((base * percent) / 100);
  if (amount <= 0) return;

  const { error } = await admin.from("partner_commissions").upsert(
    {
      partner_id: hotel.partner_id,
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      stripe_invoice_id: invoice.id,
      invoice_amount: base,
      percent,
      amount,
      currency: invoice.currency,
    },
    { onConflict: "stripe_invoice_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}
