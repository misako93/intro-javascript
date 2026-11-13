import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { getMyHotel } from "@/lib/hotel";
import { getOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";

// Phrase d'accroche de l'affiche, dans les langues les plus fréquentes en hôtellerie.
const LINES: [string, string, boolean?][] = [
  ["🇫🇷", "Besoin d’aide ? Écrivez à la réception dans votre langue"],
  ["🇬🇧", "Need help? Message the front desk in your language"],
  ["🇸🇦", "تحتاج مساعدة؟ راسل الاستقبال بلغتك", true],
  ["🇪🇸", "¿Necesita ayuda? Escriba a recepción en su idioma"],
  ["🇩🇪", "Hilfe nötig? Schreiben Sie der Rezeption in Ihrer Sprache"],
  ["🇨🇳", "需要帮助？用您的语言联系前台"],
  ["🇷🇺", "Нужна помощь? Напишите на ресепшн на своём языке"],
  ["🇹🇷", "Yardım mı lazım? Resepsiyona kendi dilinizde yazın"],
];

/** Affiche A4 à imprimer pour l'accueil. */
export default async function PosterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/hotel/poster");
  const hotel = await getMyHotel(supabase, user.id);
  if (!hotel) redirect("/hotel");

  const qr = await qrSvg(`${await getOrigin()}/q/${hotel.desk_token}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[210mm] flex-col items-center bg-white px-8 py-10 text-center print:min-h-0 print:py-6">
      <div className="mb-6 print:hidden"><PrintButton label="🖨️ Imprimer l’affiche (A4)" /></div>
      <p className="text-6xl">🛎️</p>
      <h1 className="mt-4 text-4xl font-extrabold">{hotel.name}</h1>
      <p className="mt-2 text-xl font-semibold text-emerald-700">Scan · امسح · Scannez · Escanee · 扫码</p>
      <div className="my-8 w-[85mm] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
      <ul className="space-y-2 text-lg">
        {LINES.map(([flag, text, rtl]) => (
          <li key={flag} dir={rtl ? "rtl" : "ltr"}>
            <span className="me-2">{flag}</span>
            {text}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-slate-500">Sans application · Sans inscription · Traduction automatique</p>
    </main>
  );
}
