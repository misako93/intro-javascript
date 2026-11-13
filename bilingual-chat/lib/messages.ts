import type { SupabaseClient } from "@supabase/supabase-js";
import { translateText, type ContextLine } from "@/lib/ai/translate";
import { hasLetters, isLanguage, sameLanguage } from "@/lib/languages";
import type { Message } from "@/lib/types";
import { getParticipants, recipientsOf } from "@/lib/participants";

/**
 * Langues dans lesquelles traduire un message :
 * la "langue de traduction" de l'expéditeur + la langue de chaque destinataire.
 */
export async function targetLanguagesFor(db: SupabaseClient, roomId: string, senderId: string) {
  const participants = await getParticipants(db, roomId);
  const sender = participants.find((p) => p.user_id === senderId);
  const langs = new Set<string>();
  if (sender) langs.add(sender.target_lang);
  for (const r of recipientsOf(participants, senderId)) langs.add(r.my_lang);
  return [...langs];
}

/** Langues des destinataires (pour la détection de langue). */
export async function recipientLanguages(db: SupabaseClient, roomId: string, senderId: string) {
  return recipientsOf(await getParticipants(db, roomId), senderId).map((p) => p.my_lang);
}

async function loadContext(db: SupabaseClient, message: Message): Promise<ContextLine[]> {
  const { data } = await db
    .from("messages")
    .select("sender_id, original_text")
    .eq("room_id", message.room_id)
    .eq("status", "ready")
    .lt("created_at", message.created_at)
    .order("created_at", { ascending: false })
    .limit(6);

  return (data ?? [])
    .reverse()
    .filter((m) => m.original_text)
    .map((m) => ({ speaker: m.sender_id === message.sender_id ? "A" : "B", text: m.original_text.slice(0, 500) }));
}

/** Langue d'origine effective d'un message : celle détectée, sinon celle du profil de l'expéditeur. */
export function messageLanguage(message: Pick<Message, "detected_lang" | "source_lang">) {
  return message.detected_lang || message.source_lang;
}

/** Faut-il traduire ce message pour un lecteur de langue `lang` ? */
export function needsTranslation(message: Pick<Message, "detected_lang" | "source_lang" | "original_text">, lang: string) {
  return hasLetters(message.original_text) && !sameLanguage(messageLanguage(message), lang);
}

/**
 * Traduit un message dans les langues demandées et enregistre chaque traduction (→ temps réel).
 * Les langues identiques à celle du message sont ignorées : AUCUN appel à l'IA.
 */
export async function translateMessage(db: SupabaseClient, message: Message, langs: string[]) {
  const from = messageLanguage(message);
  const targets = [...new Set(langs)].filter((l) => isLanguage(l) && needsTranslation(message, l));
  if (!targets.length) return {} as Record<string, string>;

  const context = await loadContext(db, message);
  const results: Record<string, string> = {};

  await Promise.all(
    targets.map(async (lang) => {
      try {
        const translated = await translateText({
          text: message.original_text,
          from,
          to: lang,
          context,
        });
        const { error } = await db.rpc("add_translation", {
          p_message_id: message.id,
          p_lang: lang,
          p_text: translated,
        });
        if (error) throw error;
        results[lang] = translated;
      } catch (err) {
        console.error(`[translate] message ${message.id} → ${lang}`, err);
      }
    }),
  );

  return results;
}
