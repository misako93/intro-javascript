import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshPartnerAccount } from "@/lib/stripe";
import { becomePartner, createHotelInvite } from "@/app/partenaire/actions";
import { APP_NAME } from "@/lib/config";
import { displayNameOf } from "@/lib/utils";
import {
  DEFAULT_COMMISSION_PERCENT,
  PARTNER_PAYOUTS_ENABLED,
  PAYOUT_COUNTRIES,
  formatMoney,
  getPartner,
  hotelStatus,
  monthlyCommission,
  planLabel,
  type HotelStatus,
  type PartnerHotel,
} from "@/lib/partners";

const ERRORS: Record<string, string> = {
  nom: "Indiquez votre nom.",
  inscription: "L’inscription n’a pas fonctionné. Réessayez.",
  hotel: "Indiquez le nom de l’hôtel.",
  invitation: "L’hôtel n’a pas pu être ajouté. Réessayez.",
};

const BANK_MESSAGES: Record<string, string> = {
  retour: "Merci. Si Stripe a encore besoin d’une information, le bouton ci-dessous vous y ramène.",
  indisponible: "Le versement automatique n’est pas encore activé. Vos commissions sont bien enregistrées.",
  erreur: "Stripe n’a pas pu ouvrir la page. Réessayez dans un instant.",
};

const TONES: Record<HotelStatus["tone"], string> = {
  slate: "bg-slate-100 text-slate-700",
  sky: "bg-sky-100 text-sky-800",
  emerald: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
};

const input =
  "mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

export default async function PartnerPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; banque?: string }>;
}) {
  const { erreur, banque } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/login?next=/partenaire");

  let partner = await getPartner(supabase, user.id);
  const error = erreur ? ERRORS[erreur] : null;

  // ── Pas encore partenaire : inscription ────────────────────────────
  if (!partner) {
    return (
      <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500">← Retour</Link>
        <h1 className="mt-4 text-2xl font-bold">🤝 Devenez partenaire {APP_NAME}</h1>
        <ol className="mt-5 space-y-3 text-slate-700">
          <li>1. Vous présentez {APP_NAME} à un hôtel.</li>
          <li>2. Le gérant scanne votre QR code et crée son espace en 2 minutes.</li>
          <li>
            3. Vous touchez <strong>{DEFAULT_COMMISSION_PERCENT} % de son abonnement, chaque mois</strong>, tant qu’il reste client.
            Versement automatique sur votre compte bancaire.
          </li>
        </ol>
        <form action={becomePartner} className="mt-6 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          {error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
          <label className="block text-sm font-medium text-slate-700">
            Votre nom
            <input name="name" required maxLength={60} defaultValue={displayNameOf(user)} className={input} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Votre téléphone (WhatsApp)
            <input name="phone" type="tel" maxLength={30} placeholder="+20 …" className={input} />
          </label>
          <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white hover:bg-emerald-700">
            Créer mon espace partenaire
          </button>
        </form>
      </main>
    );
  }

  // Compte bancaire : relire l'état chez Stripe au retour du formulaire, ou tant qu'il n'est pas validé.
  let bankError = false;
  if (PARTNER_PAYOUTS_ENABLED && partner.stripe_account_id && (banque === "retour" || !partner.payouts_enabled)) {
    try {
      const r = await refreshPartnerAccount(createAdminClient(), partner.user_id, partner.stripe_account_id);
      partner = { ...partner, payouts_enabled: r.payoutsEnabled, bank_label: r.bankLabel };
    } catch (err) {
      console.error("[partenaire] lecture du compte Stripe", err);
      bankError = true;
    }
  }

  const [{ data: hotelsData }, { data: commissions }, { data: payouts }] = await Promise.all([
    supabase.rpc("partner_hotels"),
    supabase
      .from("partner_commissions")
      .select("id, hotel_name, amount, currency, status, created_at")
      .order("created_at", { ascending: false })
      .limit(24),
    supabase.from("partner_payouts").select("amount, currency, status, created_at").eq("status", "paid"),
  ]);
  const hotels = (hotelsData ?? []) as PartnerHotel[];
  const percent = partner.commission_percent;

  const pending = (commissions ?? []).filter((c) => c.status === "pending").reduce((s, c) => s + c.amount, 0);
  const paidTotal = (payouts ?? []).reduce((s, p) => s + p.amount, 0);
  const payingCount = hotels.filter((h) => hotelStatus(h).paying).length;
  const monthly = hotels.filter((h) => hotelStatus(h).paying).reduce((s, h) => s + monthlyCommission(h, percent), 0);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6 pb-16">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500">← Retour</Link>
        <h1 className="mt-3 text-2xl font-bold">🤝 Espace partenaire</h1>
        <p className="text-sm text-slate-500">
          {partner.display_name} · {percent.toLocaleString("fr-FR")} % de l’abonnement de chaque hôtel, chaque mois
        </p>
      </div>

      {error && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">{error}</p>}

      {/* Chiffres clés */}
      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs text-slate-500">Hôtels abonnés</p>
          <p className="mt-1 text-2xl font-bold">
            {payingCount}
            <span className="text-base font-normal text-slate-400"> / {hotels.length}</span>
          </p>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs text-slate-500">À recevoir</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{formatMoney(pending)}</p>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs text-slate-500">Déjà reçu</p>
          <p className="mt-1 text-2xl font-bold">{formatMoney(paidTotal)}</p>
        </div>
      </section>
      {monthly > 0 && (
        <p className="-mt-3 text-sm text-slate-600">
          Avec vos hôtels actuels : environ <strong>{formatMoney(monthly)} par mois</strong> pour vous.
        </p>
      )}

      {/* Inscrire un hôtel */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">＋ Inscrire un hôtel</h2>
        <p className="mt-1 text-sm text-slate-600">
          Vous obtenez un QR code à faire scanner au gérant. L’hôtel est relié à vous dès qu’il crée son espace.
        </p>
        <form action={createHotelInvite} className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Nom de l’hôtel
            <input name="hotel_name" required maxLength={80} placeholder="Ex : Hôtel Riviera" className={input} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Nom du gérant <span className="font-normal text-slate-400">(facultatif)</span>
              <input name="contact_name" maxLength={60} className={input} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Son téléphone <span className="font-normal text-slate-400">(facultatif)</span>
              <input name="contact_phone" type="tel" maxLength={30} className={input} />
            </label>
          </div>
          <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white hover:bg-emerald-700">
            Obtenir le QR code
          </button>
        </form>
      </section>

      {/* Mes hôtels */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Mes hôtels</h2>
        {hotels.length === 0 ? (
          <p className="rounded-3xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            Aucun hôtel pour le moment.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            {hotels.map((h) => {
              const st = hotelStatus(h);
              const plan = planLabel(h);
              return (
                <li key={h.invite_id}>
                  <Link href={`/partenaire/hotel/${h.invite_id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{h.hotel_name}</p>
                      <p className="truncate text-sm text-slate-500">
                        {st.paying && plan
                          ? `${plan} · ${formatMoney(monthlyCommission(h, percent))} / mois pour vous`
                          : h.contact_name || `Ajouté le ${new Date(h.invited_at).toLocaleDateString("fr-FR")}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${TONES[st.tone]}`}>{st.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Compte bancaire */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">🏦 Mon compte bancaire</h2>
        <p className="mt-1 text-sm text-slate-600">
          Vos commissions sont versées automatiquement chaque mois. Les commissions d’un mois sont versées le mois suivant.
        </p>
        {banque && BANK_MESSAGES[banque] && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{BANK_MESSAGES[banque]}</p>}
        {bankError && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{BANK_MESSAGES.erreur}</p>}

        {!PARTNER_PAYOUTS_ENABLED ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            L’ajout du compte bancaire sera disponible très bientôt. Vos commissions sont déjà comptées.
          </p>
        ) : partner.payouts_enabled ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium text-emerald-700">✓ {partner.bank_label ?? "Compte bancaire validé"}</p>
            <form action="/api/partners/bank" method="post">
              <button className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200">Modifier</button>
            </form>
          </div>
        ) : (
          <form action="/api/partners/bank" method="post" className="mt-4 space-y-3">
            {partner.stripe_account_id ? (
              <p className="text-sm text-amber-800">Il manque encore une information pour valider votre compte.</p>
            ) : (
              <label className="block text-sm font-medium text-slate-700">
                Pays de votre banque
                <select name="country" defaultValue="EG" className={input}>
                  {PAYOUT_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="w-full rounded-2xl bg-slate-900 px-4 py-3.5 font-semibold text-white hover:bg-slate-800">
              {partner.stripe_account_id ? "Terminer" : "Ajouter mon compte bancaire"}
            </button>
            <p className="text-xs text-slate-500">
              Vous remplissez vos coordonnées sur la page sécurisée de Stripe, notre prestataire de paiement. {APP_NAME} ne voit jamais votre RIB.
            </p>
          </form>
        )}
      </section>

      {/* Historique */}
      {commissions && commissions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Mes commissions</h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            {commissions.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="w-24 shrink-0 text-slate-500">
                  {new Date(c.created_at).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.hotel_name}</span>
                <span className="font-semibold">{formatMoney(c.amount, c.currency)}</span>
                <span
                  className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold ${
                    c.status === "paid" ? "bg-emerald-100 text-emerald-800" : c.status === "canceled" ? "bg-slate-100 text-slate-500" : "bg-sky-100 text-sky-800"
                  }`}
                >
                  {c.status === "paid" ? "Versée" : c.status === "canceled" ? "Annulée" : "À recevoir"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
