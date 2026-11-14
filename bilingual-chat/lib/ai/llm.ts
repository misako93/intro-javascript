/**
 * Appel au modèle de langage (Claude ou GPT-4o-mini), partagé par la traduction et l'assistant.
 * - ANTHROPIC_API_KEY présente → Claude ; sinon OPENAI_API_KEY → GPT-4o-mini.
 * - TRANSLATION_PROVIDER=anthropic|openai pour forcer.
 * - OPENAI_BASE_URL / ANTHROPIC_BASE_URL : optionnels (fournisseur compatible, tests).
 * - OpenRouter : OPENAI_BASE_URL=https://openrouter.ai/api/v1, OPENAI_API_KEY=<clé OpenRouter>,
 *   OPENAI_TRANSLATION_MODEL=openai/gpt-4o-mini (ou tout autre modèle de openrouter.ai/models).
 */
type LlmInput = { system: string; user: string; json?: boolean; maxTokens?: number };

export function pickProvider(): "anthropic" | "openai" {
  const forced = process.env.TRANSLATION_PROVIDER;
  if (forced === "anthropic" || forced === "openai") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error("Aucune clé IA configurée (ANTHROPIC_API_KEY ou OPENAI_API_KEY)");
}

async function withAnthropic({ system, user, json, maxTokens = 2048 }: LlmInput): Promise<string> {
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: maxTokens,
      system: json ? `${system}\n\nRespond with a single JSON object and nothing else.` : system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

async function withOpenAI({ system, user, json, maxTokens = 2048 }: LlmInput): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      // En-têtes facultatifs recommandés par OpenRouter (identification de l'application)
      ...(base.includes("openrouter.ai")
        ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://localhost", "X-Title": process.env.NEXT_PUBLIC_APP_NAME || "Tarjem" }
        : {}),
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export async function callLLM(input: LlmInput): Promise<string> {
  return pickProvider() === "anthropic" ? withAnthropic(input) : withOpenAI(input);
}

/** Extrait l'objet JSON d'une réponse (tolère un éventuel texte autour). */
export function parseJsonObject<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
