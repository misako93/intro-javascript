import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, StreamEvent } from "../types";
import { buildUserContent, systemPrompt } from "./prompts";
import { executeTool, toolLabel, toolParamsFor } from "./tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** The part of the SDK stream the loop relies on (lets tests inject a fake). */
export interface AgentStream {
  on(event: "text", listener: (delta: string) => void): unknown;
  on(event: "streamEvent", listener: (event: Anthropic.Beta.BetaRawMessageStreamEvent) => void): unknown;
  finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
}
export type CreateStream = (params: StreamParams, options: { signal?: AbortSignal }) => AgentStream;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentSettings {
  model: string;
  effort: Effort;
  fallbacks: boolean;
}

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentSettings {
  const effort = EFFORTS.find((e) => e === env.CLAUDE_EFFORT) ?? "low";
  return {
    model: env.CLAUDE_MODEL?.trim() || "claude-opus-5-5",
    effort,
    fallbacks: env.CLAUDE_FALLBACKS !== "off",
  };
}

/** An error whose message is safe and useful to show to the end user. */
export class AgentError extends Error {}

const MAX_TURNS = 12;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let sharedClient: Anthropic | undefined;
const defaultCreateStream: CreateStream = (params, options) => {
  sharedClient ??= new Anthropic();
  return sharedClient.beta.messages.stream(params, options);
};

export interface RunOptions {
  request: ChatRequest;
  emit: (event: StreamEvent) => void;
  signal?: AbortSignal;
  settings?: AgentSettings;
  createStream?: CreateStream;
}

/**
 * Runs one user turn: streams Claude's answer, executes the tools it calls
 * and loops until it stops calling tools.
 */
export async function runAgent({
  request,
  emit,
  signal,
  settings = settingsFromEnv(),
  createStream = defaultCreateStream,
}: RunOptions): Promise<void> {
  const ctx = { agentId: request.agentId, store: request.store };
  const tools = toolParamsFor(request.agentId);
  const system = systemPrompt(request.agentId, request.store);

  // Earlier turns are replayed as plain text. Thinking blocks are only passed
  // back inside this turn's tool loop, where the prefix never changes.
  const history = request.history.filter((turn) => turn.text.trim());
  while (history.length && history[0].role !== "user") history.shift();
  const messages: MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: buildUserContent(request.message, request.workspace) },
  ];

  let useFallbacks = settings.fallbacks;
  let emittedSomething = false;
  let needsSeparator = false;
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = createStream(
      {
        model: settings.model,
        max_tokens: 64000,
        system,
        tools,
        messages,
        output_config: { effort: settings.effort },
        cache_control: { type: "ephemeral" },
        // If a safety classifier declines a request by mistake, the API
        // retries it on the recommended fallback model instead of failing.
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      },
      { signal },
    );

    const openTools = new Map<number, { id: string; chars: number; reported: number }>();
    stream.on("text", (delta) => {
      if (!delta) return;
      if (needsSeparator) {
        emit({ type: "text", delta: "\n\n" });
        needsSeparator = false;
      }
      emittedSomething = true;
      emit({ type: "text", delta });
    });
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        const { id, name } = event.content_block;
        openTools.set(event.index, { id, chars: 0, reported: 0 });
        emittedSomething = true;
        emit({ type: "tool_start", id, name, label: toolLabel(name) });
      } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
        const open = openTools.get(event.index);
        if (!open) return;
        open.chars += event.delta.partial_json.length;
        if (open.chars - open.reported >= 150) {
          open.reported = open.chars;
          emit({ type: "tool_progress", id: open.id, chars: open.chars });
        }
      }
    });

    const closeOpenTools = (summary: string) => {
      for (const open of openTools.values()) emit({ type: "tool_end", id: open.id, ok: false, summary });
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      closeOpenTools("Interrompu");
      if (signal?.aborted) throw error;
      // The fallback option is a beta: if the API rejects the very first
      // request, try once more without it before giving up.
      if (error instanceof Anthropic.BadRequestError && useFallbacks && !emittedSomething) {
        console.warn("[agent] request rejected with fallbacks enabled, retrying without:", error.message);
        useFallbacks = false;
        continue;
      }
      // With eager input streaming, a tool input that is not parseable JSON
      // rejects here. Only that case is retried; API errors are rethrown.
      if (error instanceof Anthropic.APIError || jsonRetries++ >= 2) throw error;
      continue;
    }

    if (message.stop_reason === "refusal") {
      closeOpenTools("Annulé");
      emit({
        type: "text",
        delta: `${emittedSomething ? "\n\n" : ""}Je ne peux pas traiter cette demande telle qu'elle est formulée. Reformulez-la ou donnez-moi un peu plus de contexte.`,
      });
      return;
    }

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0) return;

    // A tool input cut off by max_tokens can still look like valid JSON.
    if (message.stop_reason === "max_tokens") {
      closeOpenTools("Coupé");
      throw new AgentError("La réponse a été coupée avant la fin. Relancez avec une demande plus ciblée.");
    }

    messages.push({ role: "assistant", content: message.content });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await executeTool(toolUse.name, toolUse.input, ctx);
      if (result.deliverable) emit({ type: "deliverable", deliverable: result.deliverable });
      emit({ type: "tool_end", id: toolUse.id, ok: !result.isError, summary: result.summary });
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
    needsSeparator = emittedSomething;
  }

  emit({
    type: "text",
    delta: "\n\nJ'ai atteint la limite d'étapes pour cette demande. Dites-moi « continue » pour reprendre.",
  });
}

/** Turns any failure into a message the end user can act on. */
export function friendlyError(error: unknown): string {
  if (error instanceof AgentError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "La clé API Claude est refusée. Vérifiez la variable ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "Cette clé API n'a pas accès au modèle demandé.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "Modèle introuvable. Vérifiez la variable CLAUDE_MODEL.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Limite de requêtes atteinte. Réessayez dans une minute.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `L'API Claude a refusé la requête : ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Connexion à Claude impossible. Vérifiez le réseau et réessayez.";
  }
  if (error instanceof Anthropic.APIError) {
    return "Claude est momentanément indisponible. Réessayez dans quelques secondes.";
  }
  return "Une erreur inattendue est survenue. Réessayez.";
}
