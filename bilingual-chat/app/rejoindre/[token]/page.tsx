import { notFound, redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import LanguageSelect from "@/components/LanguageSelect";
import { createClient } from "@/lib/supabase/server";
import { getMyHotel } from "@/lib/hotel";
import { claimInvite } from "@/app/rejoindre/[token]/actions";
import { APP_NAME } from "@/lib/config";
import { displayNameOf } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  already_claimed: "Cette invitation a déjà été utilisée pour un autre compte.",
  hotel_has_partner: "Votre hôtel est déjà relié à un autre partenaire.",
  own_invite: "C’est votre propre invitation : faites-la scanner au gérant de l’hôtel.",
  invalid_invite: "Cette invitation n’existe plus.",
  inconnue: "Une erreur est survenue. Réessayez.",
};

const input =
  "mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

/** Page ouverte par le gérant de l'hôtel quand il scanne le QR code du partenaire. */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { token } = await params;
  const { erreur } = await searchParams;
  if (!/^[a-f0-9]{32}$/i.test(token)) notFound();

  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("get_hotel_invite", { p_token: token }),
    supabase.auth.getUser(),
  ]);
  const invite = (data as { hotel_name: string; partner_name: string; claimed: boolean; is_partner: boolean }[] | null)?.[0];
  if (!invite) notFound();
  const user = auth.user && !auth.user.is_anonymous ? auth.user : null;
  const found = user ? await getMyHotel(supabase, user.id) : null;
  const myHotel = found?.role === "owner" ? found : null; // seul le responsable peut relier son hôtel

  if (invite.claimed && !erreur && myHotel) redirect("/hotel");
  const error = erreur ? ERRORS[erreur] ?? ERRORS.inconnue : invite.claimed ? ERRORS.already_claimed : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-emerald-50 to-slate-50 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-4 text-2xl font-bold">{invite.hotel_name}</h1>
          <p className="mt-2 text-slate-600">
            Vos clients vous écrivent dans leur langue. Toute votre équipe reçoit le message traduit sur son téléphone.
          </p>
          {invite.partner_name && <p className="mt-2 text-sm text-slate-500">Présenté par {invite.partner_name}</p>}
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-emerald-900/5 ring-1 ring-slate-100">
          {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

          {invite.is_partner ? (
            <p className="text-center text-slate-600">Montrez le QR code de cette page au gérant de l’hôtel.</p>
          ) : invite.claimed ? null : !user ? (
            <>
              <p className="mb-4 text-center font-semibold">Gratuit pour commencer, sans carte bancaire.</p>
              <LoginForm next={`/rejoindre/${token}`} />
            </>
          ) : myHotel ? (
            <form action={claimInvite} className="space-y-4 text-center">
              <input type="hidden" name="token" value={token} />
              <p className="text-slate-700">
                Vous avez déjà l’espace <strong>{myHotel.name}</strong>. Le relier à {invite.partner_name || "ce partenaire"} ?
              </p>
              <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white hover:bg-emerald-700">Oui, relier</button>
            </form>
          ) : (
            <form action={claimInvite} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <label className="block text-sm font-medium text-slate-700">
                Nom de l’hôtel
                <input name="name" required maxLength={80} defaultValue={invite.hotel_name} className={input} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Votre prénom
                <input name="display_name" maxLength={60} defaultValue={displayNameOf(user)} className={input} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Langue de la réception
                <LanguageSelect name="lang" defaultValue="fr" className="mt-1 w-full" />
              </label>
              <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white hover:bg-emerald-700">
                Créer l’espace de mon hôtel
              </button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">{APP_NAME}</p>
      </div>
    </main>
  );
}
