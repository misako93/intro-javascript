import { NextResponse, after, type NextRequest } from "next/server";
import { createClient, createTokenClient } from "@/lib/supabase/server";
import { isLanguage } from "@/lib/languages";
import { targetLanguagesFor, translateMessage } from "@/lib/messages";
import { UUID_RE } from "@/lib/utils";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LENGTH = 4000;

/**
 * POST /api/translate
 *  - { roomId, text }       → enregistre un nouveau message texte puis le traduit en arrière-plan
 *  - { messageId, lang }    → (re)traduit un message existant dans une langue donnée
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // ── Cas 2 : retraduction à la demande ───────────────────────────
  if (typeof body.messageId === "string") {
    const lang = body.lang;
    if (!UUID_RE.test(body.messageId) || !isLanguage(lang)) {
      return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
    }
    const { data: message } = await supabase.from("messages").select("*").eq("id", body.messageId).maybeSingle();
    if (!message) return NextResponse.json({ error: "Message introuvable" }, { status: 404 });

    const result = await translateMessage(supabase, message as Message, [lang]);
    if (!result[lang]) return NextResponse.json({ error: "La traduction a échoué" }, { status: 502 });
    return NextResponse.json({ lang, translation: result[lang] });
  }

  // ── Cas 1 : nouveau message texte ───────────────────────────────
  const roomId = body.roomId;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (typeof roomId !== "string" || !UUID_RE.test(roomId) || !text) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }
  if (text.length > MAX_LENGTH) {
    return NextResponse.json({ error: `Message trop long (max ${MAX_LENGTH} caractères)` }, { status: 400 });
  }

  const { data: me } = await supabase
    .from("room_members")
    .select("my_lang")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      room_id: roomId,
      sender_id: user.id,
      kind: "text",
      original_text: text,
      source_lang: me.my_lang,
      status: "ready",
    })
    .select()
    .single();
  if (error || !message) {
    console.error("[translate] insert", error);
    return NextResponse.json({ error: "Envoi impossible" }, { status: 500 });
  }

  // Le message s'affiche tout de suite chez les 2 participants (temps réel) ;
  // la traduction arrive juste après, sans bloquer la réponse.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (accessToken) {
    after(async () => {
      const db = createTokenClient(accessToken);
      const langs = await targetLanguagesFor(db, roomId, user.id);
      await translateMessage(db, message as Message, langs);
    });
  }

  return NextResponse.json({ message });
}
