import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { PARTNER_PAYOUTS_ENABLED } from "@/lib/partners";

export const runtime = "nodejs";

/**
 * Versement mensuel des commissions (à appeler une fois par mois par une tâche planifiée,
 * le jour choisi) : POST avec l'en-tête  Authorization: Bearer <CRON_SECRET>.
 *
 * Verse toutes les commissions "à recevoir" des mois PRÉCÉDENTS (celles du mois en cours
 * attendent le mois suivant : cela laisse le temps à un éventuel remboursement).
 * Un partenaire sans compte bancaire validé est simplement reporté au mois suivant.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!PARTNER_PAYOUTS_ENABLED) return NextResponse.json({ error: "Stripe non configuré" }, { status: 503 });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const period = monthStart.slice(0, 7); // "2026-12" : sert de clé anti-doublon chez Stripe

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("partner_commissions")
    .select("id, partner_id, amount, currency, partners!inner(stripe_account_id, payouts_enabled)")
    .eq("status", "pending")
    .lt("created_at", monthStart);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; partner_id: string; amount: number; currency: string; partners: { stripe_account_id: string | null; payouts_enabled: boolean } };
  const groups = new Map<string, { partnerId: string; account: string; currency: string; amount: number; ids: string[] }>();
  let skipped = 0;
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (!r.partners.payouts_enabled || !r.partners.stripe_account_id) {
      skipped++;
      continue;
    }
    const key = `${r.partner_id}:${r.currency}`;
    const g = groups.get(key) ?? { partnerId: r.partner_id, account: r.partners.stripe_account_id, currency: r.currency, amount: 0, ids: [] };
    g.amount += r.amount;
    g.ids.push(r.id);
    groups.set(key, g);
  }

  const results: { partner: string; amount: number; currency: string; ok: boolean; error?: string }[] = [];
  for (const g of groups.values()) {
    if (g.amount <= 0) continue;
    try {
      const transfer = await stripe().transfers.create(
        {
          amount: g.amount,
          currency: g.currency,
          destination: g.account,
          description: `Commissions partenaire ${period}`,
          metadata: { partner_user_id: g.partnerId, period },
        },
        { idempotencyKey: `partner-payout-${g.partnerId}-${g.currency}-${period}` },
      );
      const { data: payout } = await admin
        .from("partner_payouts")
        .insert({ partner_id: g.partnerId, amount: g.amount, currency: g.currency, stripe_transfer_id: transfer.id, status: "paid" })
        .select("id")
        .single();
      await admin.from("partner_commissions").update({ status: "paid", payout_id: payout?.id ?? null }).in("id", g.ids);
      results.push({ partner: g.partnerId, amount: g.amount, currency: g.currency, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[partenaire] versement", g.partnerId, message);
      await admin
        .from("partner_payouts")
        .insert({ partner_id: g.partnerId, amount: g.amount, currency: g.currency, status: "failed", error: message.slice(0, 500) });
      results.push({ partner: g.partnerId, amount: g.amount, currency: g.currency, ok: false, error: message });
    }
  }

  return NextResponse.json({ period, paid: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, skipped, results });
}
