import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { getMyHotel } from "@/lib/hotel";
import { getOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";

/** Planche de QR codes (un par chambre), à imprimer et découper. */
export default async function RoomsPrintPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/hotel/rooms");
  const hotel = await getMyHotel(supabase, user.id);
  if (!hotel) redirect("/hotel");

  const origin = await getOrigin();
  const { data: rooms } = await supabase.from("hotel_rooms").select("label, token").eq("hotel_id", hotel.id).order("label");
  const cards = await Promise.all((rooms ?? []).map(async (r) => ({ ...r, svg: await qrSvg(`${origin}/q/${r.token}`) })));

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <p className="text-slate-600">{cards.length} QR codes · imprimez puis découpez selon les pointillés</p>
        <PrintButton />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.token} className="break-inside-avoid rounded-xl border-2 border-dashed border-slate-300 p-3 text-center">
            <p className="text-xs font-medium text-slate-500">{hotel.name}</p>
            <p className="text-lg font-bold">Chambre · Room {c.label}</p>
            <div className="mx-auto my-2 w-[38mm] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: c.svg }} />
            <p className="text-[11px] leading-tight text-slate-600">
              Une question ? Scannez · Need anything? Scan
              <br />
              <span dir="rtl">تحتاج شيئًا؟ امسح الرمز</span>
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
