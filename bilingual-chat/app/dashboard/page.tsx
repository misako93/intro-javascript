import Link from "next/link";
import { redirect } from "next/navigation";
import NewRoomForm from "@/components/NewRoomForm";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/languages";
import { APP_NAME } from "@/lib/config";
import { formatRelative } from "@/lib/utils";

type RoomRow = {
  id: string;
  partner_name: string;
  created_at: string;
  room_members: { user_id: string; display_name: string; my_lang: string; target_lang: string }[];
  messages: { original_text: string; kind: string; created_at: string; sender_id: string }[];
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("rooms")
    .select(
      "id, partner_name, created_at, room_members(user_id, display_name, my_lang, target_lang), messages(original_text, kind, created_at, sender_id)",
    )
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });

  const rooms = ((data ?? []) as RoomRow[])
    .map((room) => {
      const me = room.room_members.find((m) => m.user_id === user.id);
      const partner = room.room_members.find((m) => m.user_id !== user.id);
      const last = room.messages[0];
      return {
        id: room.id,
        name: partner?.display_name || room.partner_name || "Mon contact",
        waiting: !partner,
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

      <NewRoomForm defaultMyLang={lastMe?.my_lang} defaultTargetLang={lastMe?.target_lang} />

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Mes conversations</h2>

      {rooms.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500">
          <p className="text-4xl">💬</p>
          <p className="mt-3">Aucune conversation pour le moment.</p>
          <p className="text-sm">Créez-en une et envoyez le lien à votre interlocuteur.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          {rooms.map((room) => {
            const my = getLanguage(room.me?.my_lang);
            const their = getLanguage(room.me?.target_lang);
            const preview = room.last
              ? room.last.kind === "audio" && !room.last.original_text
                ? "🎤 Message vocal"
                : `${room.last.sender_id === user.id ? "Vous : " : ""}${room.last.kind === "audio" ? "🎤 " : ""}${room.last.original_text}`
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
                      <p className="truncate font-semibold">{room.name}</p>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelative(room.activity)}</span>
                    </div>
                    <p className="truncate text-sm text-slate-500" dir="auto">
                      {preview}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {my.flag} {my.label} ⇄ {their.flag} {their.label}
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
