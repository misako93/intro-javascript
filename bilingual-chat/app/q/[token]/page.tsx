import Link from "next/link";
import { headers } from "next/headers";
import GuestStart from "@/components/GuestStart";
import { parseAcceptLanguage, pickLanguage } from "@/lib/languages";
import { makeT, RTL_LOCALES, uiLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/config";

type Entry = { hotel_name: string; room_label: string | null; hotel_lang: string; is_staff: boolean };

/** Page ouverte en scannant le QR code de l'accueil ou d'une chambre. */
export default async function HotelQrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_hotel_entry", { p_token: token });
  const entry = ((data ?? []) as Entry[])[0];

  // Langue du téléphone, connue dès la première requête (en-tête Accept-Language) :
  // la page s'affiche directement dans la bonne langue, sans passer par l'anglais.
  const phoneLang = pickLanguage(parseAcceptLanguage((await headers()).get("accept-language")));
  const locale = uiLocale(phoneLang);

  if (!entry) {
    return (
      <main dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"} lang={locale} className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="text-5xl">🔗</p>
          <p className="mt-4 text-slate-600">{makeT(locale)("invalid_qr")}</p>
        </div>
      </main>
    );
  }

  // Un réceptionniste qui scanne son propre QR (pour tester) : on le renvoie vers son espace.
  if (entry.is_staff) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-5xl">🛎️</p>
          <h1 className="mt-4 text-xl font-semibold">Ce QR code fonctionne ✓</h1>
          <p className="mt-2 text-slate-600">
            Vous faites partie de l’équipe de <strong>{entry.hotel_name}</strong>. Vos clients qui le scannent arrivent sur
            une page dans leur langue et vous écrivent directement. Pour tester comme un client, ouvrez ce lien en navigation
            privée ou sur un autre téléphone.
          </p>
          <Link href="/dashboard" className="mt-6 inline-block rounded-full bg-emerald-600 px-5 py-3 font-medium text-white">
            Voir les conversations
          </Link>
        </div>
      </main>
    );
  }

  return <GuestStart token={token} hotelName={entry.hotel_name} roomLabel={entry.room_label} initialLang={phoneLang} appName={APP_NAME} />;
}
