import http from "node:http";
import type { AddressInfo } from "node:net";

// A local stand-in for the Claude Messages API. It speaks the same streaming
// protocol (server-sent events), so the real SDK and the real agent loop run
// against it unchanged. It checks nothing about model quality: it exists to
// exercise the request the app builds and the way the app reads the stream.

interface RecordedRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

type Block =
  | { type: "thinking"; signature: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

const TOOL_INPUTS: Record<string, unknown> = {
  propose_product_update: {
    product_id: "p2",
    reason: "La fiche tient en deux phrases : l'acheteur ne sait pas ce qui rend ce savon « authentique ».",
    title: "Savon d'Alep traditionnel 200 g – huile d'olive et laurier",
    description:
      "Un savon d'Alep cuit au chaudron, à l'huile d'olive et à l'huile de baie de laurier.\n\n• Pain de 200 g, estampillé à la main\n• Séché plusieurs mois à l'air libre\n\nÀ compléter : le pourcentage d'huile de laurier.",
    tags: ["savon d'Alep", "huile de laurier", "savon solide", "soin corps"],
  },
  create_email: {
    name: "Relance panier — rappel simple",
    send_timing: "1 h après l'abandon",
    subject: "Vous avez oublié quelque chose ?",
    preheader: "Votre panier vous attend encore quelques jours.",
    headline: "Votre panier est toujours là",
    paragraphs: ["Vous avez laissé des articles dans votre panier.", "Nous les gardons de côté : il suffit d'un clic pour reprendre."],
    cta_label: "Reprendre mon panier",
    featured_product_ids: ["p2"],
  },
  create_video_script: {
    platform: "Instagram Reels",
    title: "Savon d'Alep — la coupe",
    duration_seconds: 20,
    hook: "« Regardez la couleur à l'intérieur. »",
    scenes: [
      { visual: "Un couteau coupe le pain de savon en deux", voiceover: "Regardez la couleur à l'intérieur.", on_screen_text: "Vert à cœur", seconds: 6 },
      { visual: "Les deux moitiés posées côte à côte", voiceover: "Brun dehors, vert dedans : c'est le signe d'un long séchage.", on_screen_text: "", seconds: 8 },
      { visual: "Le savon dans une main, sous l'eau", voiceover: "Le pain de 200 grammes est sur la boutique.", on_screen_text: "Lien en bio", seconds: 6 },
    ],
    caption: "Brun dehors, vert dedans.",
    hashtags: ["#savondalep", "savon", "soinnaturel", "routinesoin", "faitmain"],
    cta: "Lien en bio",
  },
};

/** What the fake model answers, given the conversation it receives. */
function nextBlocks(body: any): { blocks: Block[]; stop: string } {
  const messages: any[] = body.messages;
  let lastUserTurn = messages.length - 1;
  while (lastUserTurn > 0 && typeof messages[lastUserTurn].content !== "string") lastUserTurn--;
  const step = messages.slice(lastUserTurn + 1).filter((m) => m.role === "assistant").length;
  const toolNames: string[] = (body.tools ?? []).map((t: any) => t.name);

  if (step === 0) {
    return {
      stop: "tool_use",
      blocks: [
        { type: "thinking", signature: "sig-turn-1" },
        { type: "text", text: "Je lis d'abord votre catalogue." },
        { type: "tool_use", id: "toolu_read", name: "list_products", input: {} },
      ],
    };
  }
  if (step === 1) {
    const name = ["propose_product_update", "create_email", "create_video_script"].find((n) => toolNames.includes(n))!;
    return {
      stop: "tool_use",
      blocks: [
        { type: "thinking", signature: "sig-turn-2" },
        { type: "tool_use", id: "toolu_write", name, input: TOOL_INPUTS[name] },
      ],
    };
  }
  return {
    stop: "end_turn",
    blocks: [{ type: "text", text: "C'est prêt : le livrable vous attend. **Prochaine étape** : dites-moi si je continue." }],
  };
}

function sseEvents(blocks: Block[], stop: string, model: string): string {
  const out: string[] = [];
  const send = (event: Record<string, unknown>) => out.push(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  send({
    type: "message_start",
    message: { id: "msg_fake", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
  });
  blocks.forEach((block, index) => {
    if (block.type === "thinking") {
      // Thinking text is omitted by default on current models: empty text plus a signature.
      send({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "text") {
      send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of block.text.match(/.{1,12}/gs) ?? []) {
        send({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
      }
    } else {
      send({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      // Tool input arrives as fragments of one JSON document, cut at arbitrary places.
      const json = JSON.stringify(block.input);
      for (const piece of json.match(/.{1,37}/gs) ?? []) {
        send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: piece } });
      }
    }
    send({ type: "content_block_stop", index });
  });
  send({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } });
  send({ type: "message_stop" });
  return out.join("");
}

export async function startFakeClaude(options: { delayMs?: number; port?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      requests.push({ path: req.url ?? "", headers: req.headers, body });
      // Current SDK releases send the API key as a bearer token.
      if (req.headers.authorization === "Bearer sk-invalid") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid api key" } }));
        return;
      }
      const { blocks, stop } = nextBlocks(body);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const events = sseEvents(blocks, stop, body.model).split(/(?<=\n\n)/);
      for (const event of events) {
        res.write(event);
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Run directly to keep a fake API up for a manual session:
//   FAKE_PORT=4010 npx tsx tests/fake-claude.ts
// then start the app with ANTHROPIC_BASE_URL=http://127.0.0.1:4010 and any ANTHROPIC_API_KEY.
if (process.argv[1]?.endsWith("fake-claude.ts")) {
  const port = process.env.FAKE_PORT ? Number(process.env.FAKE_PORT) : undefined;
  void startFakeClaude({ delayMs: Number(process.env.FAKE_DELAY_MS ?? 25), port }).then((fake) => {
    console.log(`Fake Claude API listening on ${fake.url}`);
  });
}
