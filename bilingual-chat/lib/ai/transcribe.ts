/** Transcription d'un message vocal avec OpenAI Whisper (whisper-1). */
export async function transcribeAudio(audio: Blob, filename: string, language?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY manquante");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  if (language) form.append("language", language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
