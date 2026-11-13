import type { SupabaseClient } from "@supabase/supabase-js";
import { translateText, type ContextLine } from "@/lib/ai/translate";
import { isLanguage } from "@/lib/languages";
import type { Member, Message } from "@/lib/types";

/**
 * Langues dans lesquelles traduire un message :
 * la "langue de traduction" de l'expéditeur + la langue de chaque autre participant.
 */
export async function targetLanguagesFor(db: SupabaseClient, roomId: string, senderId: string) {
  const { data } = await db.from("room_members").select("user_id, my_lang, target_lang").eq("room_id", roomId);
  const members = (data ?? []) as Pick<Member, "user_id" | "my_lang" | "target_lang">[];
  const langs = new Set<string>();
  for (const m of members) {
    if (m.user_id === senderId) langs.add(m.target_lang);
    else langs.add(m.my_lang);
  }
  return [...langs];
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

/** Traduit un message dans les langues demandées et enregistre chaque traduction (→ temps réel). */
export async function translateMessage(db: SupabaseClient, message: Message, langs: string[]) {
  const targets = [...new Set(langs)].filter((l) => isLanguage(l) && l !== message.source_lang);
  if (!targets.length || !message.original_text.trim()) return {} as Record<string, string>;

  const context = await loadContext(db, message);
  const results: Record<string, string> = {};

  await Promise.all(
    targets.map(async (lang) => {
      try {
        const translated = await translateText({
          text: message.original_text,
          from: message.source_lang,
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
