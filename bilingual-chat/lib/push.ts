import { sendNotification, WebPushError } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLanguage } from "@/lib/languages";
import type { Message } from "@/lib/types";

export const PUSH_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/**
 * Notifie les autres participants d'un nouveau message,
 * avec le texte DÉJÀ TRADUIT dans la langue de chacun.
 */
export async function notifyRoom(message: Message, translations: Record<string, string>) {
  if (!PUSH_ENABLED) return;
  try {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("room_members")
      .select("user_id, display_name, my_lang")
      .eq("room_id", message.room_id);
    if (!members?.length) return;

    const sender = members.find((m) => m.user_id === message.sender_id);
    const recipients = members.filter((m) => m.user_id !== message.sender_id);
    if (!recipients.length) return;

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
        const lang = recipient.my_lang;
        const text =
          (lang === message.source_lang ? message.original_text : translations[lang] || message.translations?.[lang]) ||
          message.original_text ||
          "🎤 Message vocal";
        const payload = JSON.stringify({
          title: `${sender?.display_name || "Nouveau message"}${message.kind === "audio" ? " 🎤" : ""}`,
          body: text.slice(0, 180),
          url: `/chat/${message.room_id}`,
          tag: message.room_id,
          lang: getLanguage(lang).speech,
        });
        try {
          await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            vapidDetails,
            TTL: 60 * 60 * 24,
            urgency: "high",
          });
        } catch (err) {
          // 404/410 : l'appareil s'est désabonné → on nettoie
          if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) expired.push(s.id);
          else console.error("[push]", err);
        }
      }),
    );
    if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
  } catch (err) {
    console.error("[push] notifyRoom", err);
  }
}
