import Link from "next/link";
import { redirect } from "next/navigation";
import NewRoomForm from "@/components/NewRoomForm";
import InstallBanner from "@/components/InstallBanner";
import DashboardLive from "@/components/DashboardLive";
import NotificationsBanner from "@/components/NotificationsBanner";
import { PlanCard } from "@/components/Billing";
import { ACTIVE_STATUSES, BILLING_ENABLED, FREE_MESSAGES_PER_ROOM } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/languages";
import { APP_NAME, PRICE_LABEL } from "@/lib/config";
import { formatRelative } from "@/lib/utils";
import { getMyHotel } from "@/lib/hotel";

type RoomRow = {
  id: string;
  partner_name: string;
  hotel_id: string | null;
  room_label: string | null;
  created_at: string;
  room_members: { user_id: string; display_name: string; my_lang: string; target_lang: string }[];
  messages: {
    original_text: string;
    kind: string;
    created_at: string;
    sender_id: string;
    is_ai: boolean;
    translations: Record<string, string> | null;
  }[];
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const guest = Boolean(user.is_anonymous); // client d'hôtel (session invité, sans compte)

  const [{ data }, { data: subscription }, hotel] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        "id, partner_name, hotel_id, room_label, created_at, room_members(user_id, display_name, my_lang, target_lang), messages(original_text, kind, created_at, sender_id, is_ai, translations)",
      )
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" }),
    supabase
      .from("subscriptions")
      .select("status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle(),
    guest ? Promise.resolve(null) : getMyHotel(supabase, user.id),
  ]);
  const subscribed =
    Boolean(subscription && ACTIVE_STATUSES.includes(subscription.status)) &&
    (!subscription?.current_period_end || new Date(subscription.current_period_end) > new Date());

  const rooms = ((data ?? []) as RoomRow[])
    .map((room) => {
      const me = room.room_members.find((m) => m.user_id === user.id);
      const partner = room.room_members.find((m) => m.user_id !== user.id);
      const last = room.messages[0];
      // Conversation d'hôtel vue par la réception : "Ahmed · Ch. 204" (ou "· Accueil")
      const isHotelDesk = Boolean(room.hotel_id && !me);
      const place = room.room_label ? `Ch. ${room.room_label}` : "Accueil";
      return {
        id: room.id,
        name: isHotelDesk
          ? `${partner?.display_name || "Client"} · ${place}`
          : room.hotel_id
            ? room.partner_name
            : partner?.display_name || room.partner_name || "Mon contact",
        waiting: !partner && !room.hotel_id,
        hotelDesk: isHotelDesk,
        guestLang: partner?.my_lang,
        me,
        last,
        activity: last?.created_at ?? room.created_at,
      };
    })
    .sort((a, b) => b.activity.localeCompare(a.activity));

  // Pré-remplit le formulaire avec les langues de la dernière conversation.
  const lastMe = rooms[0]?.me;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span className="text-xl font-bold">{APP_NAME}</span>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-full px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Déconnexion</button>
        </form>
      </header>

      <DashboardLive userId={user.id} />
      <InstallBanner />
      <div className="-mx-4 mb-4 overflow-hidden sm:mx-0 sm:rounded-2xl">
        <NotificationsBanner partnerName="un client" />
      </div>

      {hotel ? (
        <Link href="/hotel" className="mb-4 flex items-center gap-3 rounded-3xl bg-slate-900 p-4 text-white">
          <span className="text-3xl">🏨</span>
          <span className="flex-1">
            <span className="block font-semibold">{hotel.name}</span>
            <span className="text-sm text-slate-300">QR codes, chambres et équipe de réception</span>
          </span>
          <span className="text-slate-400">→</span>
        </Link>
      ) : (
        !guest && (
          <Link href="/hotel" className="mb-4 block rounded-3xl border-2 border-dashed border-slate-200 p-4 text-sm text-slate-600 hover:bg-white">
            🏨 <strong>Vous êtes un hôtel ?</strong> Créez votre QR code d’accueil : vos clients vous écrivent dans leur
            langue, toute l’équipe reçoit la traduction. →
          </Link>
        )
      )}

      {!guest && <NewRoomForm defaultMyLang={lastMe?.my_lang} defaultTargetLang={lastMe?.target_lang} />}

      {BILLING_ENABLED && !guest && (
        <PlanCard
          active={subscribed}
          cancelAtPeriodEnd={Boolean(subscription?.cancel_at_period_end)}
          periodEnd={subscription?.current_period_end ?? null}
          freeMessages={FREE_MESSAGES_PER_ROOM}
          priceLabel={PRICE_LABEL}
        />
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Mes conversations</h2>

      {rooms.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500">
          <p className="text-4xl">💬</p>
          <p className="mt-3">Aucune conversation pour le moment.</p>
          <p className="text-sm">
            {hotel ? "Les messages de vos clients (QR code) apparaîtront ici." : "Créez-en une et envoyez le lien à votre interlocuteur."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          {rooms.map((room) => {
            const my = getLanguage(room.me?.my_lang);
            const their = getLanguage(room.me?.target_lang);
            const guestLang = getLanguage(room.guestLang);
            // Aperçu dans la langue du lecteur (la réception lit dans la langue de l'hôtel).
            const readerLang = room.me?.my_lang ?? hotel?.default_lang;
            const lastText = room.last
              ? (readerLang && room.last.translations?.[readerLang]) || room.last.original_text
              : "";
            const author = room.last?.is_ai ? "🤖 Assistant : " : room.last?.sender_id === user.id ? "Vous : " : "";
            const preview = room.last
              ? room.last.kind === "audio" && !room.last.original_text
                ? "🎤 Message vocal"
                : `${author}${room.last.kind === "audio" ? "🎤 " : ""}${lastText}`
              : room.waiting
                ? "En attente de votre invité·e…"
                : "Dites bonjour 👋";
            return (
              <li key={room.id}>
                <Link href={`/chat/${room.id}`} className="flex items-center gap-3 px-4 py-4 transition hover:bg-slate-50">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-700">
                    {room.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold" dir="auto">{room.name}</p>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelative(room.activity)}</span>
                    </div>
                    <p className="truncate text-sm text-slate-500" dir="auto">
                      {preview}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {room.hotelDesk ? `🛎️ Client · ${guestLang.flag} ${guestLang.label}` : `${my.flag} ${my.label} ⇄ ${their.flag} ${their.label}`}
                      {room.waiting && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Invitation envoyée ?</span>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
