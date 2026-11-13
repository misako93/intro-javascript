"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Composer from "@/components/Composer";
import LanguageSelect from "@/components/LanguageSelect";
import MessageBubble from "@/components/MessageBubble";
import { InviteButton, InviteCard } from "@/components/InviteButton";
import NotificationsBanner from "@/components/NotificationsBanner";
import { Paywall, TrialBanner } from "@/components/Billing";
import { useT } from "@/components/I18n";
import { GUEST_UI_AUTO } from "@/lib/i18n";
import type { RoomBilling } from "@/lib/billing";
import { getLanguage } from "@/lib/languages";
import { playChime } from "@/lib/sound";
import type { HotelContext, Member, Message, Participant, Room } from "@/lib/types";

type Pending = { tempId: string; kind: "text" | "audio"; text: string; failed?: boolean; paywall?: boolean; retry: () => void };

type Props = {
  room: Room;
  /** Conversation d'hôtel (QR code) : nom de l'hôtel, chambre, et si je fais partie de l'équipe */
  hotel?: HotelContext | null;
  initialMembers: Participant[];
  initialMessages: Message[];
  userId: string;
  initialBilling: RoomBilling;
  priceLabel: string;
};

const byDate = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

export default function ChatRoom({ room, hotel, initialMembers, initialMessages, userId, initialBilling, priceLabel }: Props) {
  const t = useT();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [members, setMembers] = useState<Participant[]>(initialMembers);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [billing, setBilling] = useState<RoomBilling>(initialBilling);
  const [toast, setToast] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 3 vues : conversation classique, réceptionniste (staff), ou client de l'hôtel (guest)
  const mode: "standard" | "staff" | "guest" = !hotel ? "standard" : hotel.is_staff ? "staff" : "guest";
  const me = members.find((m) => m.user_id === userId)!;
  const partner =
    mode === "staff" ? members.find((m) => m.role === "member") : members.find((m) => m.user_id !== userId);
  const partnerName =
    mode === "guest"
      ? hotel!.hotel_name
      : partner?.display_name || (mode === "staff" ? "Client" : room.partner_name) || "Votre contact";
  const place = hotel ? (hotel.room_label ? t("room", { label: hotel.room_label }) : t("desk")) : "";
  // Un réceptionniste voit sa propre traduction dans la langue du client, quelle qu'elle soit.
  const myTarget = mode === "staff" ? (partner?.my_lang ?? me.target_lang) : me.target_lang;

  const upsertMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === msg.id);
      if (i === -1) return [...prev, msg].sort(byDate);
      const next = [...prev];
      next[i] = { ...next[i], ...msg };
      return next;
    });
  }, []);

  const upsertMember = useCallback((member: Member & { role?: Participant["role"] }) => {
    setMembers((prev) => {
      const i = prev.findIndex((m) => m.user_id === member.user_id);
      if (i === -1) return [...prev, { role: "member" as const, ...member }];
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
    let cancelled = false;
    let firstSubscribe = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

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
              const msg = payload.new as Message;
              if (payload.eventType === "INSERT" && msg.sender_id !== userId && !(mode === "staff" && msg.is_ai)) {
                playChime("message");
              }
              upsertMessage(msg);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            const member = payload.new as Member;
            if (payload.eventType === "INSERT" && member.user_id !== userId) {
              playChime("join");
              if (mode !== "guest") {
                setToast(`🛎️ ${member.display_name || "Votre contact"} vient de rejoindre la conversation`);
              }
              setTimeout(() => setToast(""), 4000);
            }
            upsertMember(member);
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
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, room.id, userId, mode, upsertMessage, upsertMember, resync]);

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
      if (!translation) return true; // même langue : rien à afficher en plus
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
    // Réceptionniste : sa langue est enregistrée sur son profil d'équipe (vaut pour tous les clients).
    const { error } =
      mode === "staff"
        ? await supabase
            .from("hotel_staff")
            .update({ my_lang: patch.my_lang ?? me.my_lang })
            .eq("hotel_id", hotel!.hotel_id)
            .eq("user_id", userId)
        : await supabase.from("room_members").update(patch).eq("room_id", room.id).eq("user_id", userId);
    if (error) upsertMember(previous);
    // Client de l'hôtel : l'interface passe dans sa nouvelle langue.
    else if (mode === "guest" && patch.my_lang) router.refresh();
  }

  const myLang = getLanguage(me.my_lang);
  const partnerLang = partner ? getLanguage(partner.my_lang) : null;

  const subtitle = !online
    ? t("reconnecting")
    : mode === "guest"
      ? place
      : mode === "staff"
        ? `${place}${partnerLang ? ` · ${partnerLang.flag} ${partnerLang.label}` : ""}`
        : partnerLang
          ? `Lit en ${partnerLang.flag} ${partnerLang.label}`
          : "Pas encore rejoint";

  return (
    <div className="flex h-dvh flex-col">
      {/* En-tête */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5">
          {mode !== "guest" && (
            <Link href="/dashboard" className="grid h-10 w-10 place-items-center rounded-full text-xl text-slate-600 hover:bg-slate-100" aria-label="Retour">
              ←
            </Link>
          )}
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 font-semibold text-emerald-700">
            {mode === "guest" ? "🛎️" : partnerName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight" dir="auto">{partnerName}</p>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
          {mode === "standard" && <InviteButton token={room.invite_token} />}
        </div>

        {/* Paramètres de langue */}
        {mode === "guest" ? (
          <div className="mx-auto max-w-3xl px-3 pb-3">
            <label className="flex flex-col text-xs font-medium text-slate-500">
              {t("my_language")}
              <LanguageSelect native={GUEST_UI_AUTO} value={me.my_lang} onChange={(v) => updateLanguages({ my_lang: v })} className="mt-1 w-full py-2 text-sm" aria-label={t("my_language")} />
            </label>
          </div>
        ) : mode === "staff" ? (
          <div className="mx-auto flex max-w-3xl items-end gap-2 px-3 pb-3">
            <label className="flex min-w-0 flex-1 flex-col text-xs font-medium text-slate-500">
              Ma langue
              <LanguageSelect value={me.my_lang} onChange={(v) => updateLanguages({ my_lang: v })} className="mt-1 w-full py-2 text-sm" aria-label="Ma langue" />
            </label>
            <span className="mb-2.5 text-slate-400">⇄</span>
            <div className="flex min-w-0 flex-1 flex-col text-xs font-medium text-slate-500">
              Langue du client
              <p className="mt-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {partnerLang ? `${partnerLang.flag} ${partnerLang.label}` : "—"}
              </p>
            </div>
          </div>
        ) : (
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
        )}
      </header>

      {mode !== "guest" && <TrialBanner billing={billing} roomId={room.id} />}
      {(partner || mode === "guest") && <NotificationsBanner partnerName={partnerName} />}

      {/* Messages */}
      <main className="chat-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-4">
          {mode === "standard" && billing.enabled && billing.premium && billing.sponsorName && (
            <p className="text-center text-xs text-slate-500">
              ✨ Conversation illimitée, offerte par{" "}
              {billing.sponsorName === me.display_name ? "votre abonnement" : billing.sponsorName}
            </p>
          )}

          {mode === "standard" && !partner && <InviteCard token={room.invite_token} partnerName={partnerName} />}

          {messages.length === 0 && mode === "guest" && (
            <p className="px-4 py-10 text-center text-slate-500" dir="auto">{t("empty_guest")}</p>
          )}
          {messages.length === 0 && mode === "staff" && (
            <p className="py-10 text-center text-slate-500">Le client n’a pas encore écrit.</p>
          )}
          {messages.length === 0 && mode === "standard" && partner && (
            <p className="py-10 text-center text-slate-500">
              Écrivez ou enregistrez un vocal en {myLang.flag} {myLang.label}.<br />
              {partnerName} le recevra traduit instantanément.
            </p>
          )}

          {messages.map((m) => {
            // Réception : tout ce qui vient de l'hôtel (moi, mes collègues, l'assistant IA) est "de mon côté".
            const fromHotel = mode === "staff" && m.sender_id !== partner?.user_id;
            const mine = mode === "staff" ? fromHotel : m.sender_id === userId;
            const wanted =
              mode === "staff"
                ? m.is_ai || !fromHotel
                  ? me.my_lang // je lis l'assistant et le client dans ma langue
                  : myTarget // je vérifie la traduction envoyée au client
                : mine
                  ? myTarget
                  : me.my_lang;
            const colleague =
              fromHotel && !m.is_ai && m.sender_id !== userId
                ? members.find((p) => p.user_id === m.sender_id)?.display_name || "Collègue"
                : undefined;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                mine={mine}
                wantedLang={wanted}
                label={colleague}
                onTranslate={translate}
              />
            );
          })}

          {pending.map((p) => (
            <div key={p.tempId} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-600/70 px-3.5 py-2.5 text-white sm:max-w-[70%]">
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  {p.kind === "audio" ? `🎤 ${t("record")}` : p.text}
                </p>
                {p.failed ? (
                  <button onClick={p.retry} className="mt-1 text-sm font-semibold underline">
                    {p.paywall && mode !== "guest" ? "Abonnement requis · Renvoyer" : t("send_failed")}
                  </button>
                ) : (
                  <p className="mt-1 text-right text-[11px] text-emerald-50">{t("sending")}</p>
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
          <Composer
            onSendText={sendText}
            onSendAudio={sendAudio}
            placeholder={mode === "guest" ? t("placeholder", { lang: GUEST_UI_AUTO ? myLang.native : myLang.label }) : `Écrivez en ${myLang.label}…`}
          />
        ) : mode === "guest" ? (
          // Le client ne voit jamais d'écran de paiement : c'est l'hôtel qui s'abonne.
          <p className="border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-center text-slate-600" dir="auto">
            {t("unavailable")}
          </p>
        ) : (
          <Paywall billing={billing} roomId={room.id} partnerName={partnerName} priceLabel={priceLabel} />
        )}
      </div>
    </div>
  );
}
