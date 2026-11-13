import { sendNotification, WebPushError } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLanguage, sameLanguage } from "@/lib/languages";
import { messageLanguage } from "@/lib/messages";
import type { Message } from "@/lib/types";

export const PUSH_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

type Recipient = { user_id: string; display_name: string; my_lang: string };

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  lang?: string;
  /** "join" = nouvelle conversation ouverte par un client : la notification reste affichée */
  kind: "message" | "join";
};

/** Envoie une notification à chaque appareil des destinataires (payload personnalisé par personne). */
async function sendToRecipients(recipients: Recipient[], build: (r: Recipient) => PushPayload) {
  if (!PUSH_ENABLED || !recipients.length) return;
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", recipients.map((r) => r.user_id));
  if (!subs?.length) return;

  const vapidDetails = {
    subject: process.env.VAPID_SUBJECT || "mailto:contact@example.com",
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
  };

  const expired: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const recipient = recipients.find((r) => r.user_id === s.user_id)!;
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(build(recipient)),
          // urgency "high" : livraison immédiate même téléphone en veille / app en arrière-plan
          { vapidDetails, TTL: 60 * 60 * 24, urgency: "high" },
        );
      } catch (err) {
        // 404/410 : l'appareil s'est désabonné → on nettoie
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) expired.push(s.id);
        else console.error("[push]", err);
      }
    }),
  );
  if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
}

type RoomInfo = { hotel_id: string | null; room_label: string | null; created_by: string; hotel_name?: string };

/** Participants vus côté serveur (clé service_role) : membres + équipe de l'hôtel. */
async function roomParticipants(roomId: string) {
  const admin = createAdminClient();
  const [{ data: room }, { data: members }] = await Promise.all([
    admin.from("rooms").select("hotel_id, room_label, created_by").eq("id", roomId).maybeSingle(),
    admin.from("room_members").select("user_id, display_name, my_lang").eq("room_id", roomId),
  ]);
  const list: (Recipient & { role: "member" | "staff" })[] = ((members ?? []) as Recipient[]).map((m) => ({
    ...m,
    role: "member",
  }));
  if (room?.hotel_id) {
    const { data: h } = await admin.from("hotels").select("name").eq("id", room.hotel_id).maybeSingle();
    (room as RoomInfo).hotel_name = h?.name;
    const { data: staff } = await admin
      .from("hotel_staff")
      .select("user_id, display_name, my_lang")
      .eq("hotel_id", room.hotel_id);
    for (const s of (staff ?? []) as Recipient[]) {
      if (!list.some((m) => m.user_id === s.user_id)) list.push({ ...s, role: "staff" });
    }
  }
  return { room: room as RoomInfo | null, participants: list };
}

function placeLabel(room: RoomInfo | null) {
  if (!room?.hotel_id) return "";
  return room.room_label ? ` · Ch. ${room.room_label}` : " · Accueil";
}

/**
 * Nouveau message → notifie les destinataires, avec le texte DÉJÀ TRADUIT dans la langue
 * de chacun (ou l'original si c'est déjà sa langue).
 * Hôtel : un message de client sonne chez TOUTE l'équipe ; une réponse de la réception
 * ne notifie que le client. Le 1er message d'un client = alerte "Nouveau client" persistante.
 */
export async function notifyRoom(message: Message, translations: Record<string, string>) {
  if (!PUSH_ENABLED) return;
  try {
    const { room, participants } = await roomParticipants(message.room_id);
    const sender = participants.find((p) => p.user_id === message.sender_id);
    const from = messageLanguage(message);
    const recipients = participants.filter(
      (p) => p.user_id !== message.sender_id && (sender?.role !== "staff" || p.role === "member"),
    );

    let firstGuestMessage = false;
    if (room?.hotel_id && sender?.role === "member") {
      const { count } = await createAdminClient()
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", message.room_id);
      firstGuestMessage = (count ?? 0) <= 1;
    }

    await sendToRecipients(recipients, (r) => {
      const text =
        (sameLanguage(from, r.my_lang)
          ? message.original_text
          : translations[r.my_lang] || message.translations?.[r.my_lang]) ||
        message.original_text ||
        "🎤";
      const isStaffRecipient = recipients.find((p) => p.user_id === r.user_id)?.role === "staff";
      const senderName = message.is_ai
        ? `🤖 ${room?.hotel_name || "Assistant"}` // réponse de l'assistant IA, au nom de l'hôtel
        : sender?.display_name || (isStaffRecipient ? "Client" : "") || "Nouveau message";
      return {
        kind: firstGuestMessage ? "join" : "message",
        title:
          (firstGuestMessage ? "🛎️ Nouveau client — " : "") +
          (isStaffRecipient ? `${senderName}${placeLabel(room)}` : senderName) +
          (message.kind === "audio" ? " 🎤" : ""),
        body: text.slice(0, 180),
        url: `/chat/${message.room_id}`,
        tag: message.room_id,
        lang: getLanguage(r.my_lang).speech,
      };
    });
  } catch (err) {
    console.error("[push] notifyRoom", err);
  }
}

/** Un contact vient d'ouvrir la conversation (lien d'invitation) → alerte les autres participants. */
export async function notifyJoin(roomId: string, joinerId: string) {
  if (!PUSH_ENABLED) return;
  try {
    const { participants } = await roomParticipants(roomId);
    const joiner = participants.find((m) => m.user_id === joinerId);
    const lang = getLanguage(joiner?.my_lang);
    await sendToRecipients(
      participants.filter((m) => m.user_id !== joinerId),
      () => ({
        kind: "join",
        title: "🛎️ Nouvelle conversation",
        body: `${joiner?.display_name || "Un client"} vient d’ouvrir la conversation (${lang.flag} ${lang.label}).`,
        url: `/chat/${roomId}`,
        tag: `join-${roomId}`,
      }),
    );
  } catch (err) {
    console.error("[push] notifyJoin", err);
  }
}
