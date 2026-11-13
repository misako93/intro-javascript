import type { RoomBilling } from "@/lib/billing";

function SubscribeForm({ returnTo, label, className }: { returnTo: string; label: string; className?: string }) {
  return (
    <form action="/api/billing/checkout" method="post">
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className={className}>{label}</button>
    </form>
  );
}

/** Bandeau discret pendant l'essai gratuit. */
export function TrialBanner({ billing, roomId }: { billing: RoomBilling; roomId: string }) {
  if (!billing.enabled || billing.premium || !billing.canSend) return null;
  const left = Math.max(0, billing.limit - billing.used);
  return (
    <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      <span>🎁</span>
      <p className="flex-1">
        <strong>{left}</strong> message{left > 1 ? "s" : ""} gratuit{left > 1 ? "s" : ""} restant{left > 1 ? "s" : ""}
        {billing.hotel ? " pour l’hôtel. Vos clients n’ont jamais rien à payer." : ". Un seul abonnement suffit pour vous deux."}
      </p>
      <SubscribeForm
        returnTo={`/chat/${roomId}`}
        label="Illimité"
        className="shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 font-semibold text-white"
      />
    </div>
  );
}

/** Remplace la zone de saisie quand l'essai gratuit est terminé. */
export function Paywall({
  billing,
  roomId,
  partnerName,
  priceLabel,
}: {
  billing: RoomBilling;
  roomId: string;
  partnerName: string;
  priceLabel: string;
}) {
  return (
    <div className="border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-center">
      <p className="font-semibold">Vos {billing.limit} messages gratuits sont utilisés 🎉</p>
      {billing.hotel ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          Abonnez l’hôtel pour continuer à recevoir les messages de vos clients. <strong>Toute l’équipe</strong> est
          couverte, et vos clients n’ont <strong>jamais rien à payer</strong>.
        </p>
      ) : (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          Il suffit qu’<strong>une seule personne</strong> s’abonne pour que vous discutiez <strong>tous les deux</strong> en
          illimité : vous ou {partnerName}.
        </p>
      )}
      <SubscribeForm
        returnTo={`/chat/${roomId}`}
        label={`Passer en illimité · ${priceLabel}`}
        className="mt-3 w-full max-w-md rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700"
      />
      <p className="mt-2 text-xs text-slate-400">Sans engagement · Résiliable en 1 clic · Couvre toutes vos conversations</p>
    </div>
  );
}

/** Encart "Mon abonnement" du tableau de bord. */
export function PlanCard({
  active,
  cancelAtPeriodEnd,
  periodEnd,
  freeMessages,
  priceLabel,
}: {
  active: boolean;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  freeMessages: number;
  priceLabel: string;
}) {
  const date = periodEnd ? new Date(periodEnd).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : null;

  if (active) {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <span className="text-2xl">⭐</span>
        <div className="flex-1 text-sm">
          <p className="font-semibold">Abonnement illimité actif</p>
          <p className="text-slate-500">
            Toutes vos conversations sont illimitées, pour vous et vos contacts.
            {cancelAtPeriodEnd && date && ` Se termine le ${date}.`}
          </p>
        </div>
        <form action="/api/billing/portal" method="post">
          <button className="rounded-full px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">Gérer</button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-600 p-5 text-white shadow-lg">
      <p className="text-lg font-semibold">Passez en illimité</p>
      <p className="mt-1 text-sm text-emerald-50">
        {freeMessages} messages offerts par conversation. Avec l’abonnement : messages, vocaux et traductions illimités,
        <strong> et vos contacts n’ont rien à payer</strong>.
      </p>
      <form action="/api/billing/checkout" method="post" className="mt-4">
        <input type="hidden" name="returnTo" value="/dashboard" />
        <button className="w-full rounded-2xl bg-white px-4 py-3 font-semibold text-emerald-700 transition hover:bg-emerald-50">
          S’abonner · {priceLabel}
        </button>
      </form>
    </div>
  );
}
