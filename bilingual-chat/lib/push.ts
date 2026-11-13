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

async function roomMembers(roomId: string) {
  const { data } = await createAdminClient()
    .from("room_members")
    .select("user_id, display_name, my_lang")
    .eq("room_id", roomId);
  return (data ?? []) as Recipient[];
}

/**
 * Nouveau message → notifie les autres participants,
 * avec le texte DÉJÀ TRADUIT dans la langue de chacun (ou l'original si c'est déjà sa langue).
 */
export async function notifyRoom(message: Message, translations: Record<string, string>) {
  if (!PUSH_ENABLED) return;
  try {
    const members = await roomMembers(message.room_id);
    const sender = members.find((m) => m.user_id === message.sender_id);
    const from = messageLanguage(message);

    await sendToRecipients(
      members.filter((m) => m.user_id !== message.sender_id),
      (r) => {
        const text =
          (sameLanguage(from, r.my_lang)
            ? message.original_text
            : translations[r.my_lang] || message.translations?.[r.my_lang]) ||
          message.original_text ||
          "🎤 Message vocal";
        return {
          kind: "message",
          title: `${sender?.display_name || "Nouveau message"}${message.kind === "audio" ? " 🎤" : ""}`,
          body: text.slice(0, 180),
          url: `/chat/${message.room_id}`,
          tag: message.room_id,
          lang: getLanguage(r.my_lang).speech,
        };
      },
    );
  } catch (err) {
    console.error("[push] notifyRoom", err);
  }
}

/** Un client vient d'ouvrir la conversation (lien d'invitation / QR code) → alerte la réception. */
export async function notifyJoin(roomId: string, joinerId: string) {
  if (!PUSH_ENABLED) return;
  try {
    const members = await roomMembers(roomId);
    const joiner = members.find((m) => m.user_id === joinerId);
    const lang = getLanguage(joiner?.my_lang);
    await sendToRecipients(
      members.filter((m) => m.user_id !== joinerId),
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
