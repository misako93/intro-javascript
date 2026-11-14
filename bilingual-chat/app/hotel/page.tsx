import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addRooms, createHotel, deleteRoom, removeStaff } from "@/app/hotel/actions";
import LanguageSelect from "@/components/LanguageSelect";
import CopyLink from "@/components/CopyLink";
import AssistantSettings from "@/components/AssistantSettings";
import { getMyHotel } from "@/lib/hotel";
import { getOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { getLanguage } from "@/lib/languages";
import { APP_NAME } from "@/lib/config";

export default async function HotelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/hotel");
  if (user.is_anonymous) redirect("/dashboard");

  const hotel = await getMyHotel(supabase, user.id);

  // ── Pas encore d'hôtel : création ──────────────────────────────────
  if (!hotel) {
    return (
      <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500">← Retour</Link>
        <h1 className="mt-4 text-2xl font-bold">🏨 Créer l’espace de votre hôtel</h1>
        <p className="mt-2 text-slate-600">
          Vous obtiendrez un QR code à afficher à l’accueil (et, si vous le souhaitez, un par chambre). Vos clients le
          scannent, écrivent dans leur langue, et toute votre équipe reçoit le message traduit sur son téléphone.
        </p>
        <form action={createHotel} className="mt-6 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <label className="block text-sm font-medium text-slate-700">
            Nom de l’hôtel
            <input name="name" required maxLength={80} placeholder="Ex : Hôtel Riviera" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Langue de la réception
            <LanguageSelect name="lang" defaultValue="fr" className="mt-1 w-full" />
          </label>
          <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 font-semibold text-white hover:bg-emerald-700">Créer mon espace hôtel</button>
        </form>
      </main>
    );
  }

  // ── Espace hôtel ───────────────────────────────────────────────────
  const origin = await getOrigin();
  const deskUrl = `${origin}/q/${hotel.desk_token}`;
  const staffUrl = `${origin}/staff/${hotel.staff_invite_token}`;
  const isOwner = hotel.role === "owner";
  const [deskQr, { data: rooms }, { data: staff }] = await Promise.all([
    qrSvg(deskUrl),
    supabase.from("hotel_rooms").select("id, label, token").eq("hotel_id", hotel.id).order("label"),
    supabase.from("hotel_staff").select("user_id, display_name, my_lang, role").eq("hotel_id", hotel.id).order("joined_at"),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6 pb-16">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500">← Conversations</Link>
        <h1 className="mt-3 text-2xl font-bold">🏨 {hotel.name}</h1>
        <p className="text-sm text-slate-500">
          Réception en {getLanguage(hotel.default_lang).flag} {getLanguage(hotel.default_lang).label}
        </p>
      </div>

      {/* QR de l'accueil */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">1. Le QR code de l’accueil</h2>
        <p className="mt-1 text-sm text-slate-600">
          À afficher à la réception. Même quand personne n’est au comptoir, le client scanne, écrit dans sa langue, et
          votre téléphone sonne avec le message traduit.
        </p>
        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row">
          <div className="w-40 shrink-0 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: deskQr }} />
          <div className="flex flex-col gap-2">
            <Link href="/hotel/poster" target="_blank" className="rounded-full bg-emerald-600 px-5 py-3 text-center font-semibold text-white">
              🖨️ Imprimer l’affiche
            </Link>
            <a href={deskUrl} target="_blank" rel="noopener" className="text-center text-sm text-emerald-700 underline">
              Ouvrir le lien du QR
            </a>
          </div>
        </div>
      </section>

      {/* Chambres */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">2. Un QR code par chambre (facultatif)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Chaque QR porte le numéro de la chambre : vous savez tout de suite d’où vient la demande.
        </p>
        {isOwner && (
          <form action={addRooms} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="hotel_id" value={hotel.id} />
            <input
              name="rooms"
              placeholder="Ex : 101-120, 201-220, Suite Royale"
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
            <button className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">Ajouter</button>
          </form>
        )}
        {rooms && rooms.length > 0 ? (
          <>
            <ul className="mt-4 flex flex-wrap gap-2">
              {rooms.map((r) => (
                <li key={r.id} className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm">
                  {r.label}
                  {isOwner && (
                    <form action={deleteRoom}>
                      <input type="hidden" name="room_id" value={r.id} />
                      <button className="grid h-6 w-6 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Supprimer ${r.label}`}>✕</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <Link href="/hotel/rooms" target="_blank" className="mt-4 inline-block rounded-full bg-emerald-600 px-5 py-3 font-semibold text-white">
              🖨️ Imprimer les {rooms.length} QR des chambres
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Aucune chambre pour l’instant.</p>
        )}
      </section>

      {/* Assistant IA */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">
          3. Assistant IA {hotel.assistant_enabled && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">activé</span>}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          L’IA répond seule, dans la langue du client, aux questions dont la réponse est dans vos infos pratiques (Wi-Fi,
          horaires, parking…) — même à 3 h du matin, sans réveiller la réception. Tout le reste (demande, problème,
          plainte, urgence) vous est transmis comme d’habitude. Elle n’invente jamais rien.
        </p>
        <div className="mt-4">
          <AssistantSettings hotelId={hotel.id} enabled={hotel.assistant_enabled} info={hotel.assistant_info} canEdit={isOwner} />
        </div>
      </section>

      {/* Équipe */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold">4. L’équipe de réception</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tous les membres reçoivent les messages des clients et peuvent répondre (équipe de jour, de nuit, remplaçants).
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {(staff ?? []).map((s) => {
            const l = getLanguage(s.my_lang);
            return (
              <li key={s.user_id} className="flex items-center justify-between py-2.5">
                <span>
                  {s.display_name || "Membre"}{" "}
                  <span className="text-sm text-slate-400">· {l.flag} {l.label}{s.role === "owner" ? " · responsable" : ""}{s.user_id === user.id ? " · vous" : ""}</span>
                </span>
                {isOwner && s.user_id !== user.id && (
                  <form action={removeStaff}>
                    <input type="hidden" name="hotel_id" value={hotel.id} />
                    <input type="hidden" name="user_id" value={s.user_id} />
                    <button className="text-sm text-red-600 hover:underline">Retirer</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm font-medium text-slate-700">Ajouter un réceptionniste : envoyez-lui ce lien</p>
        <div className="mt-2">
          <CopyLink url={staffUrl} message={`Rejoins l’équipe de réception de ${hotel.name} sur ${APP_NAME} :`} />
        </div>
      </section>
    </main>
  );
}
