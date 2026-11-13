import { notFound, redirect } from "next/navigation";
import ChatRoom from "@/components/ChatRoom";
import { I18nProvider } from "@/components/I18n";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/utils";
import { getRoomBilling } from "@/lib/billing";
import { getParticipants } from "@/lib/participants";
import { uiLocale } from "@/lib/i18n";
import { PRICE_LABEL } from "@/lib/config";
import type { HotelContext, Message, Room } from "@/lib/types";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/chat/${id}`);

  // Les règles RLS garantissent qu'on ne voit que ses propres conversations
  // (ou celles de son hôtel pour un réceptionniste).
  const [{ data: room }, participants, { data: messages }, { data: hotelRows }] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", id).maybeSingle(),
    getParticipants(supabase, id),
    supabase.from("messages").select("*").eq("room_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.rpc("room_hotel", { p_room_id: id }),
  ]);

  const me = participants.find((p) => p.user_id === user.id);
  if (!room || !me) notFound();

  const hotel = ((hotelRows ?? []) as HotelContext[])[0] ?? null;
  const billing = await getRoomBilling(supabase, id);

  // Le client d'un hôtel voit l'interface dans SA langue ; le personnel, en français.
  const locale = hotel && !hotel.is_staff ? uiLocale(me.my_lang) : "fr";

  return (
    <I18nProvider locale={locale}>
      <ChatRoom
        room={room as Room}
        hotel={hotel}
        initialMembers={participants}
        initialMessages={((messages ?? []) as Message[]).reverse()}
        userId={user.id}
        initialBilling={billing}
        priceLabel={PRICE_LABEL}
      />
    </I18nProvider>
  );
}
