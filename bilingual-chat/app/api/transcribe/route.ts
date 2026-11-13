import { NextResponse, after, type NextRequest } from "next/server";
import { createClient, createTokenClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { recipientLanguages, targetLanguagesFor, translateMessage } from "@/lib/messages";
import { detectMessageLanguage, whisperLanguageToIso } from "@/lib/detect-language";
import { VOICE_BUCKET } from "@/lib/config";
import { UUID_RE } from "@/lib/utils";
import { afterSend, getRoomBilling } from "@/lib/billing";
import { notifyRoom } from "@/lib/push";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 Mo (Whisper accepte jusqu'à 25 Mo)

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/webm": "webm", // certains Android étiquettent l'audio ainsi
};

/**
 * POST /api/transcribe  (multipart/form-data : audio, roomId)
 * 1. Upload du vocal dans Supabase Storage
 * 2. Création du message (visible immédiatement avec le lecteur audio)
 * 3. En arrière-plan : transcription Whisper → traduction → mise à jour temps réel
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const roomId = form?.get("roomId");

  if (!(audio instanceof File) || typeof roomId !== "string" || !UUID_RE.test(roomId)) {
    return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  }
  if (audio.size === 0 || audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Vocal vide ou trop volumineux" }, { status: 400 });
  }

  const mime = (audio.type || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext = EXTENSIONS[mime];
  if (!ext) return NextResponse.json({ error: `Format audio non supporté (${mime})` }, { status: 415 });

  const { data: me } = await supabase
    .from("room_members")
    .select("my_lang")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Paywall : un seul abonné suffit pour couvrir toute la conversation.
  const billing = await getRoomBilling(supabase, roomId);
  if (!billing.canSend) return NextResponse.json({ error: "paywall", billing }, { status: 402 });

  const bytes = new Uint8Array(await audio.arrayBuffer());
  const path = `${roomId}/${user.id}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(VOICE_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    console.error("[transcribe] upload", uploadError);
    return NextResponse.json({ error: "Envoi du vocal impossible" }, { status: 500 });
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      room_id: roomId,
      sender_id: user.id,
      kind: "audio",
      original_text: "",
      source_lang: me.my_lang,
      audio_path: path,
      status: "processing",
    })
    .select()
    .single();
  if (error || !message) {
    console.error("[transcribe] insert", error);
    return NextResponse.json({ error: "Envoi du vocal impossible" }, { status: 500 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  if (accessToken) {
    after(async () => {
      const db = createTokenClient(accessToken);
      try {
        // Whisper détecte lui-même la langue parlée (le client peut parler une autre langue que son profil).
        const { text, language } = await transcribeAudio(new Blob([bytes], { type: mime }), `voice.${ext}`);
        if (!text) throw new Error("Aucune parole détectée");

        const detected = detectMessageLanguage(
          text,
          me.my_lang,
          await recipientLanguages(db, roomId, user.id),
          whisperLanguageToIso(language),
        );

        const { data: updated, error: updateError } = await db
          .from("messages")
          .update({ original_text: text, detected_lang: detected, status: "ready" })
          .eq("id", message.id)
          .select()
          .single();
        if (updateError || !updated) throw updateError ?? new Error("Mise à jour impossible");

        const langs = await targetLanguagesFor(db, roomId, user.id);
        const translations = await translateMessage(db, updated as Message, langs);
        await notifyRoom(updated as Message, translations);
      } catch (err) {
        console.error("[transcribe]", err);
        await db
          .from("messages")
          .update({ status: "error", error: err instanceof Error ? err.message.slice(0, 200) : "Erreur" })
          .eq("id", message.id);
      }
    });
  }

  return NextResponse.json({ message, billing: afterSend(billing) });
}
