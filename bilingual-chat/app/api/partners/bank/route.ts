import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { PARTNER_PAYOUTS_ENABLED, PAYOUT_COUNTRIES, PLATFORM_COUNTRY, getPartner } from "@/lib/partners";

export const runtime = "nodejs";

/**
 * "Ajouter mon compte bancaire" : le partenaire remplit ses coordonnées sur la page
 * sécurisée de Stripe (Stripe Connect Express). Nous ne voyons jamais le RIB.
 * Déjà validé → espace Stripe du partenaire (changer de banque).
 */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/partenaire?banque=${q}`, 303);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return NextResponse.redirect(`${origin}/login?next=/partenaire`, 303);
  const partner = await getPartner(supabase, user.id);
  if (!partner) return NextResponse.redirect(`${origin}/partenaire`, 303);
  if (!PARTNER_PAYOUTS_ENABLED) return back("indisponible");

  try {
    let accountId = partner.stripe_account_id;

    if (!accountId) {
      const form = await request.formData().catch(() => null);
      const country = String(form?.get("country") ?? "").toUpperCase();
      if (!PAYOUT_COUNTRIES.some((c) => c.code === country)) return back("erreur");
      const account = await stripe().accounts.create({
        type: "express",
        country,
        email: user.email ?? undefined,
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        // Partenaire dans un autre pays que la plateforme : contrat "destinataire" (il reçoit, il n'encaisse pas).
        ...(country !== PLATFORM_COUNTRY ? { tos_acceptance: { service_agreement: "recipient" } } : {}),
        metadata: { partner_user_id: user.id },
      });
      accountId = account.id;
      await createAdminClient().from("partners").update({ stripe_account_id: accountId }).eq("user_id", user.id);
    } else {
      const account = await stripe().accounts.retrieve(accountId);
      if (account.details_submitted) {
        const login = await stripe().accounts.createLoginLink(accountId);
        return NextResponse.redirect(login.url, 303);
      }
    }

    const link = await stripe().accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/partenaire`,
      return_url: `${origin}/partenaire?banque=retour`,
    });
    return NextResponse.redirect(link.url, 303);
  } catch (err) {
    console.error("[partenaire] compte bancaire Stripe", err);
    return back("erreur");
  }
}
