"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Composer from "@/components/Composer";
import LanguageSelect from "@/components/LanguageSelect";
import MessageBubble from "@/components/MessageBubble";
import { InviteButton, InviteCard } from "@/components/InviteButton";
import NotificationsBanner from "@/components/NotificationsBanner";
import { Paywall, TrialBanner } from "@/components/Billing";
import type { RoomBilling } from "@/lib/billing";
import { getLanguage } from "@/lib/languages";
import type { Member, Message, Room } from "@/lib/types";

type Pending = { tempId: string; kind: "text" | "audio"; text: string; failed?: boolean; paywall?: boolean; retry: () => void };

type Props = {
  room: Room;
  initialMembers: Member[];
  initialMessages: Message[];
  userId: string;
  initialBilling: RoomBilling;
  priceLabel: string;
};

const byDate = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

export default function ChatRoom({ room, initialMembers, initialMessages, userId, initialBilling, priceLabel }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [billing, setBilling] = useState<RoomBilling>(initialBilling);
  const [toast, setToast] = useState("");
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

  // ── Abonnement ───────────────────────────────────────────────────
  const refreshBilling = useCallback(async () => {
    const res = await fetch(`/api/billing/room?roomId=${room.id}`).catch(() => null);
    if (!res?.ok) return null;
    const { billing: fresh } = (await res.json()) as { billing: RoomBilling };
    setBilling(fresh);
    return fresh;
  }, [room.id]);

  // Récupère les derniers messages (rattrapage après une mise en veille du téléphone, etc.)
  const resync = useCallback(async () => {
    const [{ data: latest }, { data: latestMembers }] = await Promise.all([
      supabase.from("messages").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("room_members").select("*").eq("room_id", room.id),
    ]);
    (latest as Message[] | null)?.forEach(upsertMessage);
    (latestMembers as Member[] | null)?.forEach(upsertMember);
    refreshBilling();
  }, [supabase, room.id, upsertMessage, upsertMember, refreshBilling]);

  // Retour de la page de paiement : on attend la confirmation de Stripe (webhook) quelques secondes.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("checkout") !== "success") return;
    url.searchParams.delete("checkout");
    window.history.replaceState(null, "", url.pathname + url.search);
    setToast("Paiement reçu, activation de l’abonnement…");
    let tries = 0;
    const timer = setInterval(async () => {
      const fresh = await refreshBilling();
      if (fresh?.premium || ++tries >= 10) {
        clearInterval(timer);
        setToast(fresh?.premium ? "🎉 Conversation illimitée activée, pour vous deux !" : "");
        setTimeout(() => setToast(""), 4000);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshBilling]);

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
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) {
          setBilling(data.billing);
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true, paywall: true } : x)));
          return;
        }
        if (!res.ok) throw new Error();
        upsertMessage(data.message);
        if (data.billing) setBilling(data.billing);
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
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) {
          setBilling(data.billing);
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true, paywall: true } : x)));
          return;
        }
        if (!res.ok) throw new Error();
        upsertMessage(data.message);
        if (data.billing) setBilling(data.billing);
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

      <TrialBanner billing={billing} roomId={room.id} />
      {partner && <NotificationsBanner partnerName={partnerName} />}

      {/* Messages */}
      <main className="chat-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-4">
          {billing.enabled && billing.premium && billing.sponsorName && (
            <p className="text-center text-xs text-slate-500">
              ✨ Conversation illimitée, offerte par{" "}
              {billing.sponsorName === me.display_name ? "votre abonnement" : billing.sponsorName}
            </p>
          )}

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
                    {p.paywall ? "Abonnement requis · Renvoyer" : "Échec de l’envoi · Réessayer"}
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

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <p className="rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">{toast}</p>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl">
        {billing.canSend ? (
          <Composer onSendText={sendText} onSendAudio={sendAudio} placeholder={`Écrivez en ${myLang.label}…`} />
        ) : (
          <Paywall billing={billing} roomId={room.id} partnerName={partnerName} priceLabel={priceLabel} />
        )}
      </div>
    </div>
  );
}
