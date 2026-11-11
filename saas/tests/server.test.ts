import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { auditCatalog, auditProduct } from "../lib/audit";
import { createDemoStore } from "../lib/demo-store";
import { accessCodeMatches, isDemoMode } from "../lib/server/env";
import { runMockAgent } from "../lib/server/mock-agent";
import { buildUserContent, systemPrompt } from "../lib/server/prompts";
import { type AgentStream, type CreateStream, friendlyError, runAgent } from "../lib/server/run-agent";
import { analyzeHtml, assertPublicUrl, isBlockedAddress, PageAuditError } from "../lib/server/seo-page";
import { executeTool, toolParamsFor } from "../lib/server/tools";
import { AGENT_IDS, type ChatRequest, type StreamEvent } from "../lib/types";

const request = (agentId: ChatRequest["agentId"], message = "Bonjour"): ChatRequest => ({
  agentId,
  message,
  history: [],
  store: createDemoStore(),
  workspace: { pendingCount: 0, deliverables: [] },
});

test("catalogue audit: the well-written product scores 100, the thin ones score low", () => {
  const store = createDemoStore();
  const argan = store.products.find((p) => p.id === "p7")!;
  assert.deepEqual(auditProduct(argan), { score: 100, issues: [] });
  const nigelle = auditProduct(store.products.find((p) => p.id === "p1")!);
  assert.ok(nigelle.score <= 20, `expected a low score, got ${nigelle.score}`);
  const { score, rows } = auditCatalog(store);
  assert.equal(rows.length, 8);
  assert.ok(score > 0 && score < 60);
});

test("tool definitions are plain JSON schemas with eager input streaming", () => {
  for (const agentId of AGENT_IDS) {
    const tools = toolParamsFor(agentId);
    assert.ok(tools.length >= 3);
    for (const t of tools) {
      assert.equal(t.input_schema.type, "object");
      assert.equal("$schema" in t.input_schema, false);
      assert.equal(t.eager_input_streaming, true);
      assert.ok(t.description && t.description.length > 40);
    }
  }
});

test("propose_product_update builds a pending before/after proposal", async () => {
  const ctx = { agentId: "webmaster" as const, store: createDemoStore() };
  const result = await executeTool(
    "propose_product_update",
    { product_id: "p1", reason: "Fiche trop courte", title: "Huile de nigelle pure pressée à froid – 100 ml", tags: ["a", "b"] },
    ctx,
  );
  assert.equal(result.isError, false);
  const d = result.deliverable;
  assert.ok(d && d.type === "product_update");
  assert.equal(d.status, "pending");
  assert.equal(d.agentId, "webmaster");
  assert.deepEqual(
    d.changes.map((c) => [c.field, c.before, c.after]),
    [
      ["title", "Huile nigelle 100ml", "Huile de nigelle pure pressée à froid – 100 ml"],
      ["tags", "huile", "a, b"],
    ],
  );
});

test("propose_product_update refuses over-long SEO fields, unknown products and no-op changes", async () => {
  const ctx = { agentId: "seo" as const, store: createDemoStore() };
  const tooLong = await executeTool("propose_product_update", { product_id: "p1", reason: "r", seo_title: "x".repeat(66) }, ctx);
  assert.equal(tooLong.isError, true);
  assert.equal(tooLong.deliverable, undefined);
  const unknown = await executeTool("propose_product_update", { product_id: "nope", reason: "r", title: "Un titre" }, ctx);
  assert.equal(unknown.isError, true);
  const noop = await executeTool("propose_product_update", { product_id: "p1", reason: "r", title: "Huile nigelle 100ml" }, ctx);
  assert.equal(noop.isError, true);
});

test("invalid tool input is returned to the model as an INVALID_JSON error, not executed", async () => {
  const ctx = { agentId: "email" as const, store: createDemoStore() };
  const result = await executeTool("create_email", { name: "Sans objet" }, ctx);
  assert.equal(result.isError, true);
  assert.ok(result.content.includes("INVALID_JSON"));
  assert.equal(result.deliverable, undefined);
});

test("an agent cannot call a tool outside its own set", async () => {
  const ctx = { agentId: "email" as const, store: createDemoStore() };
  const result = await executeTool("propose_product_update", { product_id: "p1", reason: "r", title: "Nouveau titre long" }, ctx);
  assert.equal(result.isError, true);
});

test("create_email snapshots featured products and defaults the button to the shop URL", async () => {
  const ctx = { agentId: "email" as const, store: createDemoStore() };
  const result = await executeTool(
    "create_email",
    { name: "Test", subject: "Objet", preheader: "Aperçu", headline: "Titre", paragraphs: ["Un", "Deux"], cta_label: "Voir", featured_product_ids: ["p8"] },
    ctx,
  );
  const d = result.deliverable;
  assert.ok(d && d.type === "email");
  assert.equal(d.ctaUrl, "https://maison-nour.example");
  assert.deepEqual(d.products, [{ title: "Coffret hammam", price: 29.9, emoji: "🎁" }]);
});

test("demo scripts run through the real tools without a single tool error", async () => {
  for (const agentId of AGENT_IDS) {
    const events: StreamEvent[] = [];
    await runMockAgent({ request: request(agentId), emit: (e) => events.push(e), speed: 0 });
    const failed = events.filter((e) => e.type === "tool_end" && !e.ok);
    assert.deepEqual(failed, [], `${agentId} demo script has failing tools`);
    assert.ok(events.some((e) => e.type === "deliverable"), `${agentId} produced no deliverable`);
    assert.ok(events.some((e) => e.type === "text"));
  }
});

test("private and local addresses are blocked for page audits", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.10", "169.254.169.254", "172.20.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "not-an-ip"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
  for (const url of ["http://127.0.0.1/admin", "http://[::1]/", "file:///etc/passwd", "http://169.254.169.254/latest/meta-data", "https://user:pw@8.8.8.8/", "http://8.8.8.8:8080/", "pas une url"]) {
    await assert.rejects(assertPublicUrl(url), PageAuditError, url);
  }
  assert.equal((await assertPublicUrl("https://8.8.8.8/page")).hostname, "8.8.8.8");
});

test("page analysis reports missing SEO elements", () => {
  const bad = analyzeHtml("<html><head><title>Hi</title></head><body><h1>A</h1><h1>B</h1><img src='a.jpg'></body></html>", "http://shop.test/");
  const status = (label: string) => bad.checks.find((c) => c.label === label)?.status;
  assert.equal(status("Balise title"), "warn");
  assert.equal(status("Meta description"), "error");
  assert.equal(status("Titre H1"), "warn");
  assert.equal(status("Textes alternatifs"), "error");
  assert.equal(status("HTTPS"), "error");
  assert.ok(bad.score < 50);

  const good = analyzeHtml(
    `<html lang="fr"><head><title>Savon d'Alep authentique 200 g | Maison Nour</title>
     <meta name="description" content="${"Un savon d'Alep traditionnel, cuit au chaudron et séché neuf mois. ".repeat(2).trim()}">
     <meta name="viewport" content="width=device-width"><link rel="canonical" href="https://shop.test/savon">
     <meta property="og:title" content="t"><meta property="og:image" content="i">
     <script type="application/ld+json">{}</script></head>
     <body><h1>Savon d'Alep</h1><h2>Composition</h2><img src="a.jpg" alt="Savon d'Alep"><p>${"mot ".repeat(200)}</p></body></html>`,
    "https://shop.test/savon",
  );
  assert.deepEqual(good.checks.filter((c) => c.status !== "ok"), []);
  assert.equal(good.score, 100);
});

test("prompts name the agent and the shop, and carry the workspace snapshot", () => {
  const store = createDemoStore();
  const prompt = systemPrompt("seo", store);
  assert.ok(prompt.includes("Agent SEO") && prompt.includes("Maison Nour"));
  assert.equal(prompt, systemPrompt("seo", store), "system prompt must be stable for caching");
  const content = buildUserContent("Optimise", { pendingCount: 2, deliverables: [{ type: "Email", title: "Bienvenue 1" }] }, new Date("2026-11-11T08:00:00Z"));
  assert.ok(content.includes("mercredi 11 novembre 2026"));
  assert.ok(content.includes("en attente de validation : 2"));
  assert.ok(content.includes("- Email : Bienvenue 1"));
  assert.ok(content.trimEnd().endsWith("Optimise"));
});

test("demo mode and access code", () => {
  assert.equal(isDemoMode({} as NodeJS.ProcessEnv), true);
  assert.equal(isDemoMode({ ANTHROPIC_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(isDemoMode({ ANTHROPIC_API_KEY: "sk-test", DEMO_MODE: "1" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(accessCodeMatches(null, {} as NodeJS.ProcessEnv), true);
  const env = { ACCESS_CODE: "webinaire" } as unknown as NodeJS.ProcessEnv;
  assert.equal(accessCodeMatches("webinaire", env), true);
  assert.equal(accessCodeMatches(" webinaire ", env), true);
  assert.equal(accessCodeMatches("autre", env), false);
  assert.equal(accessCodeMatches(null, env), false);
});

// ---- Agent loop, with the Claude stream replaced by a scripted fake --------

type Turn = { text?: string; toolUses?: { id: string; name: string; input: unknown }[]; stop: string } | { error: unknown };

function fakeClaude(turns: Turn[]) {
  const calls: Parameters<CreateStream>[0][] = [];
  const createStream: CreateStream = (params) => {
    calls.push(structuredClone(params));
    const turn = turns.shift();
    assert.ok(turn, "the loop asked for more turns than scripted");
    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
    const stream = {
      on(event: string, listener: (...args: any[]) => void) {
        (listeners[event] ??= []).push(listener);
        return stream;
      },
      async finalMessage() {
        if ("error" in turn) throw turn.error;
        const content: unknown[] = [];
        if (turn.text) {
          for (const l of listeners.text ?? []) l(turn.text, turn.text);
          content.push({ type: "text", text: turn.text });
        }
        (turn.toolUses ?? []).forEach((toolUse, i) => {
          const index = content.length;
          for (const l of listeners.streamEvent ?? []) {
            l({ type: "content_block_start", index, content_block: { type: "tool_use", id: toolUse.id, name: toolUse.name, input: {} } });
            l({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: "x".repeat(400 + i) } });
          }
          content.push({ type: "tool_use", ...toolUse });
        });
        return { content, stop_reason: turn.stop };
      },
    };
    return stream as unknown as AgentStream;
  };
  return { createStream, calls };
}

const settings = { model: "claude-opus-5-5", effort: "low" as const, fallbacks: true };

test("agent loop: streams text, runs tools, feeds results back and stops at end_turn", async () => {
  const { createStream, calls } = fakeClaude([
    {
      text: "Je regarde le catalogue.",
      toolUses: [
        { id: "tu_1", name: "list_products", input: {} },
        { id: "tu_2", name: "propose_product_update", input: { product_id: "p2", reason: "Trop court", title: "Savon d'Alep traditionnel 200 g – laurier" } },
      ],
      stop: "tool_use",
    },
    { text: "C'est prêt.", stop: "end_turn" },
  ]);
  const events: StreamEvent[] = [];
  const req = request("webmaster", "Améliore le savon");
  req.history = [
    { role: "assistant", text: "orphelin, ignoré" },
    { role: "user", text: "Salut" },
    { role: "assistant", text: "" },
    { role: "assistant", text: "Bonjour !" },
  ];
  await runAgent({ request: req, emit: (e) => events.push(e), settings, createStream });

  assert.equal(calls.length, 2);
  const first = calls[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.output_config, { effort: "low" });
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal("thinking" in first, false, "thinking must be left to the model default");
  assert.equal("tool_choice" in first, false, "forced tool choice is rejected by the model");
  assert.deepEqual(first.messages.slice(0, 2), [
    { role: "user", content: "Salut" },
    { role: "assistant", content: "Bonjour !" },
  ]);
  assert.equal(first.messages.length, 3);

  // Second request carries the assistant turn and both tool results, in one user message.
  const second = calls[1].messages;
  assert.equal(second.length, 5);
  assert.equal(second[3].role, "assistant");
  const results = second[4].content as { type: string; tool_use_id: string; is_error?: boolean }[];
  assert.deepEqual(results.map((r) => [r.type, r.tool_use_id, r.is_error]), [
    ["tool_result", "tu_1", undefined],
    ["tool_result", "tu_2", undefined],
  ]);

  assert.deepEqual(
    events.map((e) => e.type),
    ["text", "tool_start", "tool_progress", "tool_start", "tool_progress", "tool_end", "deliverable", "tool_end", "text", "text"],
  );
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.equal(text, "Je regarde le catalogue.\n\nC'est prêt.");
  const deliverable = events.find((e) => e.type === "deliverable");
  assert.ok(deliverable && deliverable.deliverable.type === "product_update");
});

test("agent loop: a tool error goes back to the model with is_error", async () => {
  const { createStream, calls } = fakeClaude([
    { toolUses: [{ id: "tu_1", name: "get_product", input: { product_id: "zzz" } }], stop: "tool_use" },
    { text: "Produit introuvable.", stop: "end_turn" },
  ]);
  const events: StreamEvent[] = [];
  await runAgent({ request: request("seo"), emit: (e) => events.push(e), settings, createStream });
  const results = calls[1].messages.at(-1)!.content as { is_error?: boolean }[];
  assert.equal(results[0].is_error, true);
  assert.deepEqual(events.find((e) => e.type === "tool_end"), { type: "tool_end", id: "tu_1", ok: false, summary: "Produit introuvable : zzz. Appelle list_products pour obtenir les identifiants." });
});

test("agent loop: retries once without the fallback beta when the first request is rejected", async () => {
  const badRequest = new Anthropic.BadRequestError(400, { type: "error" }, "beta not available", new Headers());
  const { createStream, calls } = fakeClaude([{ error: badRequest }, { text: "Bonjour.", stop: "end_turn" }]);
  const events: StreamEvent[] = [];
  await runAgent({ request: request("email"), emit: (e) => events.push(e), settings, createStream });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].fallbacks, "default");
  assert.equal("fallbacks" in calls[1], false);
  assert.equal("betas" in calls[1], false);
  assert.deepEqual(events, [{ type: "text", delta: "Bonjour." }]);
});

test("agent loop: API errors are surfaced, refusals and truncated tool calls never run tools", async () => {
  const auth = new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
  const failing = fakeClaude([{ error: auth }]);
  await assert.rejects(runAgent({ request: request("seo"), emit: () => {}, settings: { ...settings, fallbacks: false }, createStream: failing.createStream }), auth);
  assert.ok(friendlyError(auth).includes("ANTHROPIC_API_KEY"));

  const refusal = fakeClaude([{ toolUses: [{ id: "tu_1", name: "audit_catalog", input: {} }], stop: "refusal" }]);
  const events: StreamEvent[] = [];
  await runAgent({ request: request("seo"), emit: (e) => events.push(e), settings, createStream: refusal.createStream });
  assert.equal(refusal.calls.length, 1);
  assert.equal(events.some((e) => e.type === "deliverable"), false);
  assert.ok(events.some((e) => e.type === "text" && e.delta.includes("Je ne peux pas traiter")));

  const truncated = fakeClaude([{ toolUses: [{ id: "tu_1", name: "audit_catalog", input: {} }], stop: "max_tokens" }]);
  const events2: StreamEvent[] = [];
  await assert.rejects(runAgent({ request: request("seo"), emit: (e) => events2.push(e), settings, createStream: truncated.createStream }), /coupée/);
  assert.equal(events2.some((e) => e.type === "deliverable"), false);
});
