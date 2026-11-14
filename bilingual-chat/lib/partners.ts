import type { SupabaseClient } from "@supabase/supabase-js";

/** Taux proposé aux nouveaux partenaires (même valeur que la colonne partners.commission_percent). */
export const DEFAULT_COMMISSION_PERCENT = 20;

/** Le versement automatique n'est possible que si Stripe est configuré. */
export const PARTNER_PAYOUTS_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY);

/** Pays du compte Stripe de la plateforme (VTL Systems LLC → US). */
export const PLATFORM_COUNTRY = (process.env.STRIPE_PLATFORM_COUNTRY || "US").toUpperCase();

/** Pays proposés pour le compte bancaire du partenaire (versements Stripe Connect). */
export const PAYOUT_COUNTRIES: { code: string; label: string }[] = [
  { code: "FR", label: "France" },
  { code: "BE", label: "Belgique" },
  { code: "CH", label: "Suisse" },
  { code: "LU", label: "Luxembourg" },
  { code: "EG", label: "Égypte" },
  { code: "MA", label: "Maroc" },
  { code: "TN", label: "Tunisie" },
  { code: "AE", label: "Émirats arabes unis" },
  { code: "SA", label: "Arabie saoudite" },
  { code: "TR", label: "Turquie" },
  { code: "ES", label: "Espagne" },
  { code: "IT", label: "Italie" },
  { code: "DE", label: "Allemagne" },
  { code: "GB", label: "Royaume-Uni" },
  { code: "US", label: "États-Unis" },
  { code: "CA", label: "Canada" },
];

export type Partner = {
  user_id: string;
  display_name: string;
  phone: string;
  commission_percent: number;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  bank_label: string | null;
};

export async function getPartner(db: SupabaseClient, userId: string): Promise<Partner | null> {
  const { data } = await db
    .from("partners")
    .select("user_id, display_name, phone, commission_percent, stripe_account_id, payouts_enabled, bank_label")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? { ...data, commission_percent: Number(data.commission_percent) } : null;
}

export type PartnerHotel = {
  invite_id: string;
  token: string;
  hotel_name: string;
  contact_name: string;
  contact_phone: string;
  invited_at: string;
  claimed_at: string | null;
  hotel_id: string | null;
  sub_status: string | null;
  plan_amount: number | null;
  plan_currency: string | null;
  plan_interval: string | null;
  current_period_end: string | null;
};

export type HotelStatus = { label: string; tone: "slate" | "sky" | "emerald" | "amber" | "red"; paying: boolean };

/** Statut lisible d'un hôtel présenté par le partenaire. */
export function hotelStatus(h: PartnerHotel): HotelStatus {
  if (!h.claimed_at) return { label: "Pas encore inscrit", tone: "slate", paying: false };
  switch (h.sub_status) {
    case "active":
    case "trialing":
      return { label: "Abonné", tone: "emerald", paying: true };
    case "past_due":
    case "unpaid":
      return { label: "Paiement en retard", tone: "amber", paying: false };
    case "canceled":
    case "incomplete_expired":
      return { label: "Résilié", tone: "red", paying: false };
    default:
      return { label: "Essai gratuit", tone: "sky", paying: false };
  }
}

export function formatMoney(cents: number, currency = "eur") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/** "99 € / mois" à partir du forfait enregistré. */
export function planLabel(h: Pick<PartnerHotel, "plan_amount" | "plan_currency" | "plan_interval">) {
  if (h.plan_amount == null) return null;
  const per = h.plan_interval === "year" ? "an" : "mois";
  return `${formatMoney(h.plan_amount, h.plan_currency ?? "eur")} / ${per}`;
}

/** Commission mensuelle estimée pour un hôtel abonné (en centimes). */
export function monthlyCommission(h: Pick<PartnerHotel, "plan_amount" | "plan_interval">, percent: number) {
  if (h.plan_amount == null) return 0;
  const monthly = h.plan_interval === "year" ? h.plan_amount / 12 : h.plan_amount;
  return Math.round((monthly * percent) / 100);
}
