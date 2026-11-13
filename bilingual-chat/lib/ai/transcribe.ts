/**
 * Transcription d'un message vocal (Whisper), via n'importe quel service compatible OpenAI :
 * - OpenAI (par défaut) : whisper-1
 * - Groq (moins cher, très rapide) : TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1,
 *   TRANSCRIBE_MODEL=whisper-large-v3-turbo
 * Sans `language`, le service détecte la langue parlée et la renvoie (ex. "french").
 * NB : OpenRouter ne fait pas de transcription audio → il faut l'une de ces deux options.
 */
export async function transcribeAudio(
  audio: Blob,
  filename: string,
  language?: string,
): Promise<{ text: string; language: string | null }> {
  // Clé dédiée aux vocaux ; à défaut, la clé OpenAI (si elle n'est pas déjà utilisée pour OpenRouter).
  const apiKey = process.env.TRANSCRIBE_API_KEY || (!process.env.OPENAI_BASE_URL ? process.env.OPENAI_API_KEY : "");
  if (!apiKey) throw new Error("Clé de transcription manquante (TRANSCRIBE_API_KEY ou OPENAI_API_KEY)");
  const base = (process.env.TRANSCRIBE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", process.env.TRANSCRIBE_MODEL || "whisper-1");
  form.append("response_format", "verbose_json");
  if (language) form.append("language", language);

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string; language?: string };
  return { text: (data.text ?? "").trim(), language: data.language ?? null };
}
