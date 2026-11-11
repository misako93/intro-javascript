import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { createDemoStore } from "../lib/demo-store";
import { friendlyError, runAgent } from "../lib/server/run-agent";
import { AGENT_IDS, type ChatRequest, type StreamEvent } from "../lib/types";
import { startFakeClaude } from "./fake-claude";

// The real Anthropic SDK and the real agent loop, pointed at a local server
// that speaks the Messages streaming protocol. This covers what the unit
// tests cannot: the HTTP request the app really sends, and the way the SDK
// stream is consumed (text deltas, tool input fragments, thinking blocks).

let fake: Awaited<ReturnType<typeof startFakeClaude>>;

before(async () => {
  fake = await startFakeClaude();
  process.env.ANTHROPIC_BASE_URL = fake.url;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
});
after(() => fake.close());

const request = (agentId: ChatRequest["agentId"]): ChatRequest => ({
  agentId,
  message: "Améliore ce qui est prioritaire",
  history: [],
  store: createDemoStore(),
  workspace: { pendingCount: 0, deliverables: [] },
});

const settings = { model: "claude-opus-5-5", effort: "low" as const, fallbacks: true };

test("webmaster turn through the real SDK: request shape, streaming, tool loop", async () => {
  fake.requests.length = 0;
  const events: StreamEvent[] = [];
  await runAgent({ request: request("webmaster"), emit: (e) => events.push(e), settings });

  // --- What the app sent
  assert.equal(fake.requests.length, 3);
  const [first, second, third] = fake.requests;
  assert.ok(first.path.startsWith("/v1/messages"));
  assert.equal(first.headers.authorization, "Bearer sk-test-not-a-real-key");
  assert.ok(String(first.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01"));
  assert.equal(first.body.model, "claude-opus-5-5");
  assert.equal(first.body.stream, true);
  assert.equal(first.body.max_tokens, 64000);
  assert.equal(first.body.fallbacks, "default");
  assert.deepEqual(first.body.output_config, { effort: "low" });
  assert.deepEqual(first.body.cache_control, { type: "ephemeral" });
  assert.equal("betas" in first.body, false, "betas travel as a header, not in the body");
  for (const forbidden of ["thinking", "tool_choice", "temperature", "top_p", "top_k"]) {
    assert.equal(forbidden in first.body, false, `${forbidden} must not be sent to this model`);
  }
  assert.ok(first.body.system.includes("Agent Webmaster"));
  assert.deepEqual(
    first.body.tools.map((t: any) => t.name),
    [
      "list_products",
      "get_product",
      "get_store_settings",
      "audit_catalog",
      "propose_product_update",
      "propose_price_rule",
      "propose_discount_code",
      "propose_announcement_bar",
      "create_page",
    ],
  );
  for (const tool of first.body.tools) {
    assert.equal(tool.eager_input_streaming, true);
    assert.equal(tool.input_schema.type, "object");
  }
  assert.equal(first.body.messages.length, 1);
  assert.ok(first.body.messages[0].content.endsWith("Améliore ce qui est prioritaire"));

  // --- The tool loop: the assistant turn goes back unchanged (thinking block
  // and its signature included), followed by one user message of tool results.
  const assistantTurn = second.body.messages[1];
  assert.equal(assistantTurn.role, "assistant");
  assert.deepEqual(assistantTurn.content.map((b: any) => b.type), ["thinking", "text", "tool_use"]);
  assert.equal(assistantTurn.content[0].signature, "sig-turn-1");
  assert.equal(assistantTurn.content[1].text, "Je lis d'abord votre catalogue.");
  const toolResults = second.body.messages[2].content;
  assert.equal(toolResults[0].type, "tool_result");
  assert.equal(toolResults[0].tool_use_id, "toolu_read");
  assert.equal(JSON.parse(toolResults[0].content).length, 8);
  // System prompt and tools are byte-identical from one request to the next.
  assert.equal(second.body.system, first.body.system);
  assert.deepEqual(second.body.tools, first.body.tools);
  assert.deepEqual(third.body.messages.slice(0, 3), second.body.messages);
  assert.equal(third.body.messages[4].content[0].tool_use_id, "toolu_write");
  assert.equal(third.body.messages[4].content[0].is_error, undefined);

  // --- What the interface received
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.equal(
    text,
    "Je lis d'abord votre catalogue.\n\nC'est prêt : le livrable vous attend. **Prochaine étape** : dites-moi si je continue.",
  );
  assert.deepEqual(
    events.filter((e) => e.type === "tool_start").map((e) => [e.id, e.name, e.label]),
    [
      ["toolu_read", "list_products", "Lecture du catalogue"],
      ["toolu_write", "propose_product_update", "Proposition de modification"],
    ],
  );
  assert.ok(events.some((e) => e.type === "tool_progress" && e.id === "toolu_write" && e.chars > 300));
  assert.deepEqual(
    events.filter((e) => e.type === "tool_end").map((e) => [e.id, e.ok]),
    [["toolu_read", true], ["toolu_write", true]],
  );

  // The fragmented tool input was reassembled exactly, accents and line breaks included.
  const deliverable = events.find((e) => e.type === "deliverable")?.deliverable;
  assert.ok(deliverable && deliverable.type === "product_update");
  assert.equal(deliverable.productId, "p2");
  assert.deepEqual(deliverable.changes.map((c) => c.field), ["title", "description", "tags"]);
  assert.equal(deliverable.changes[0].after, "Savon d'Alep traditionnel 200 g – huile d'olive et laurier");
  assert.ok(deliverable.changes[1].after.includes("\n\n• Pain de 200 g, estampillé à la main\n"));
  assert.ok(deliverable.reason.includes("« authentique »"));
});

test("every agent completes a turn and produces its own kind of deliverable", async () => {
  const expected = { webmaster: "product_update", seo: "product_update", email: "email", social: "video_script" } as const;
  for (const agentId of AGENT_IDS) {
    const events: StreamEvent[] = [];
    await runAgent({ request: request(agentId), emit: (e) => events.push(e), settings });
    const deliverables = events.filter((e) => e.type === "deliverable").map((e) => e.deliverable);
    assert.deepEqual(deliverables.map((d) => d.type), [expected[agentId]], agentId);
    assert.deepEqual(events.filter((e) => e.type === "tool_end" && !e.ok), [], agentId);
    const d = deliverables[0];
    if (d.type === "video_script") assert.deepEqual(d.hashtags[0], "savondalep", "leading # is stripped");
    if (d.type === "email") assert.deepEqual(d.products, [{ title: "Savon Alep 200g", price: 8.5, emoji: "🧼" }]);
  }
});

test("a rejected API key surfaces as a clear message", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  // A separate client, so it is built with the bad key.
  process.env.ANTHROPIC_API_KEY = "sk-invalid";
  const client = new Anthropic({ maxRetries: 0 });
  try {
    await assert.rejects(
      runAgent({
        request: request("seo"),
        emit: () => {},
        settings,
        createStream: (params, options) => client.beta.messages.stream(params, options),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Anthropic.AuthenticationError);
        assert.equal(friendlyError(error), "La clé API Claude est refusée. Vérifiez la variable ANTHROPIC_API_KEY.");
        return true;
      },
    );
  } finally {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});
