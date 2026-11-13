"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Composer from "@/components/Composer";
import LanguageSelect from "@/components/LanguageSelect";
import MessageBubble from "@/components/MessageBubble";
import { InviteButton, InviteCard } from "@/components/InviteButton";
import { getLanguage } from "@/lib/languages";
import type { Member, Message, Room } from "@/lib/types";

type Pending = { tempId: string; kind: "text" | "audio"; text: string; failed?: boolean; retry: () => void };

type Props = {
  room: Room;
  initialMembers: Member[];
  initialMessages: Message[];
  userId: string;
};

const byDate = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

export default function ChatRoom({ room, initialMembers, initialMessages, userId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const me = members.find((m) => m.user_id === userId)!;
  const partner = members.find((m) => m.user_id !== userId);
  const partnerName = partner?.display_name || room.partner_name || "Votre contact";

  const upsertMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === msg.id);
      if (i === -1) return [...prev, msg].sort(byDate);
      const next = [...prev];
      next[i] = { ...next[i], ...msg };
      return next;
    });
  }, []);

  const upsertMember = useCallback((member: Member) => {
    setMembers((prev) => {
      const i = prev.findIndex((m) => m.user_id === member.user_id);
      if (i === -1) return [...prev, member];
      const next = [...prev];
      next[i] = { ...next[i], ...member };
      return next;
    });
  }, []);

  // Récupère les derniers messages (rattrapage après une mise en veille du téléphone, etc.)
  const resync = useCallback(async () => {
    const [{ data: latest }, { data: latestMembers }] = await Promise.all([
      supabase.from("messages").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("room_members").select("*").eq("room_id", room.id),
    ]);
    (latest as Message[] | null)?.forEach(upsertMessage);
    (latestMembers as Member[] | null)?.forEach(upsertMember);
  }, [supabase, room.id, upsertMessage, upsertMember]);

  // ── Temps réel ───────────────────────────────────────────────────
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let firstSubscribe = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(`room:${room.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as Partial<Message>).id;
              setMessages((prev) => prev.filter((m) => m.id !== oldId));
            } else {
              upsertMessage(payload.new as Message);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` },
          (payload) => {
            if (payload.eventType !== "DELETE") upsertMember(payload.new as Member);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setOnline(true);
            if (!firstSubscribe) resync();
            firstSubscribe = false;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setOnline(false);
          }
        });
    })();

    const onVisible = () => document.visibilityState === "visible" && resync();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, room.id, upsertMessage, upsertMember, resync]);

  // Défilement automatique vers le dernier message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending.length]);

  // ── Envoi ────────────────────────────────────────────────────────
  const sendText = useCallback(
    async (text: string, tempId: string = crypto.randomUUID()) => {
      const retry = () => sendText(text, tempId);
      setPending((p) => [...p.filter((x) => x.tempId !== tempId), { tempId, kind: "text", text, retry }]);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: room.id, text }),
        });
        if (!res.ok) throw new Error();
        const { message } = await res.json();
        upsertMessage(message);
        setPending((p) => p.filter((x) => x.tempId !== tempId));
      } catch {
        setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
      }
    },
    [room.id, upsertMessage],
  );

  const sendAudio = useCallback(
    async (audio: Blob, tempId: string = crypto.randomUUID()) => {
      const retry = () => sendAudio(audio, tempId);
      setPending((p) => [...p.filter((x) => x.tempId !== tempId), { tempId, kind: "audio", text: "", retry }]);
      try {
        const form = new FormData();
        form.append("roomId", room.id);
        form.append("audio", audio, `voice.${audio.type.includes("mp4") ? "mp4" : "webm"}`);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error();
        const { message } = await res.json();
        upsertMessage(message);
        setPending((p) => p.filter((x) => x.tempId !== tempId));
      } catch {
        setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
      }
    },
    [room.id, upsertMessage],
  );

  const translate = useCallback(async (messageId: string, lang: string) => {
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, lang }),
      });
      if (!res.ok) return false;
      const { translation } = await res.json();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, translations: { ...m.translations, [lang]: translation } } : m)),
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Langues ──────────────────────────────────────────────────────
  async function updateLanguages(patch: Partial<Pick<Member, "my_lang" | "target_lang">>) {
    const previous = { ...me };
    upsertMember({ ...me, ...patch });
    const { error } = await supabase.from("room_members").update(patch).eq("room_id", room.id).eq("user_id", userId);
    if (error) upsertMember(previous);
  }

  const myLang = getLanguage(me.my_lang);

  return (
    <div className="flex h-dvh flex-col">
      {/* En-tête */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5">
          <Link href="/dashboard" className="grid h-10 w-10 place-items-center rounded-full text-xl text-slate-600 hover:bg-slate-100" aria-label="Retour">
            ←
          </Link>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 font-semibold text-emerald-700">
            {partnerName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{partnerName}</p>
            <p className="truncate text-xs text-slate-500">
              {!online ? "Reconnexion…" : partner ? `Lit en ${getLanguage(partner.my_lang).flag} ${getLanguage(partner.my_lang).label}` : "Pas encore rejoint"}
            </p>
          </div>
          <InviteButton token={room.invite_token} />
        </div>

        {/* Paramètres de langue */}
        <div className="mx-auto flex max-w-3xl items-end gap-2 px-3 pb-3">
          <label className="flex min-w-0 flex-1 flex-col text-xs font-medium text-slate-500">
            Ma langue
            <LanguageSelect value={me.my_lang} onChange={(v) => updateLanguages({ my_lang: v })} className="mt-1 w-full py-2 text-sm" aria-label="Ma langue" />
          </label>
          <button
            onClick={() => updateLanguages({ my_lang: me.target_lang, target_lang: me.my_lang })}
            className="mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Inverser les langues"
            title="Inverser"
          >
            ⇄
          </button>
          <label className="flex min-w-0 flex-1 flex-col text-xs font-medium text-slate-500">
            Langue de traduction
            <LanguageSelect value={me.target_lang} onChange={(v) => updateLanguages({ target_lang: v })} className="mt-1 w-full py-2 text-sm" aria-label="Langue de traduction" />
          </label>
        </div>
      </header>

      {/* Messages */}
      <main className="chat-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-4">
          {!partner && <InviteCard token={room.invite_token} partnerName={partnerName} />}

          {messages.length === 0 && partner && (
            <p className="py-10 text-center text-slate-500">
              Écrivez ou enregistrez un vocal en {myLang.flag} {myLang.label}.<br />
              {partnerName} le recevra traduit instantanément.
            </p>
          )}

          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                mine={mine}
                wantedLang={mine ? me.target_lang : me.my_lang}
                onTranslate={translate}
              />
            );
          })}

          {pending.map((p) => (
            <div key={p.tempId} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-600/70 px-3.5 py-2.5 text-white sm:max-w-[70%]">
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  {p.kind === "audio" ? "🎤 Message vocal" : p.text}
                </p>
                {p.failed ? (
                  <button onClick={p.retry} className="mt-1 text-sm font-semibold underline">
                    Échec de l’envoi · Réessayer
                  </button>
                ) : (
                  <p className="mt-1 text-right text-[11px] text-emerald-50">Envoi…</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      <div className="mx-auto w-full max-w-3xl">
        <Composer
          onSendText={sendText}
          onSendAudio={sendAudio}
          placeholder={`Écrivez en ${myLang.label}…`}
        />
      </div>
    </div>
  );
}
