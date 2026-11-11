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
import { executeTool, roundPrice, toolParamsFor } from "../lib/server/tools";
import { analyzeSearch, buildSearchPerformance, formatPercent, formatPosition, parseCsv, parseSearchCsv, SearchImportError } from "../lib/search";
import { applyChange } from "../lib/store-changes";
import { AGENT_IDS, type ChatRequest, describeDiscount, type StoreChange, type StreamEvent } from "../lib/types";

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
    { name: "Test", subject: "Objet", alt_subject: " Objet B ", preheader: "Aperçu", headline: "Titre", paragraphs: ["Un", "Deux"], cta_label: "Voir", featured_product_ids: ["p8"] },
    ctx,
  );
  const d = result.deliverable;
  assert.ok(d && d.type === "email");
  assert.equal(d.altSubject, "Objet B");
  assert.equal(d.ctaUrl, "https://maison-nour.example");
  assert.deepEqual(d.products, [{ title: "Coffret hammam", price: 29.9, emoji: "🎁" }]);
});

test("price rounding picks the nearest price with the requested ending", () => {
  const cases: [number, "none" | "0.90" | "0.99" | "0.00", number][] = [
    [12.665, "none", 12.67],
    [12.665, "0.90", 12.9],
    [14.365, "0.90", 13.9],
    [14.45, "0.90", 14.9],
    [14.2, "0.90", 13.9],
    [0.5, "0.90", 0.9],
    [33.15, "0.99", 32.99],
    [33.6, "0.99", 33.99],
    [16.4, "0.00", 16],
    [0.3, "0.00", 1],
  ];
  for (const [price, rounding, expected] of cases) assert.equal(roundPrice(price, rounding), expected, `${price} ${rounding}`);
});

test("propose_price_rule computes prices itself, for a category, with the old price kept for display", async () => {
  const ctx = { agentId: "webmaster" as const, store: createDemoStore() };
  const result = await executeTool(
    "propose_price_rule",
    { label: "-15 % sur les Huiles", reason: "Promo", scope: { type: "category", category: "huiles" }, operation: "percent", value: -15, rounding: "0.90" },
    ctx,
  );
  assert.equal(result.isError, false);
  const d = result.deliverable;
  assert.ok(d && d.type === "price_update" && d.status === "pending");
  assert.deepEqual(
    d.changes.map((c) => [c.productId, c.before, c.after, c.compareAtAfter]),
    [
      ["p1", 14.9, 12.9, 14.9],
      ["p7", 16.9, 13.9, 16.9],
    ],
  );
  // The model reads the computed prices and the real variation back, instead of doing the maths.
  assert.deepEqual(JSON.parse(result.content).prices, [
    { product: "Huile nigelle 100ml", before: "14,90 €", after: "12,90 €", real_variation: "-13 %" },
    { product: "Huile d'argan cosmétique bio – 50 ml, pressée à froid", before: "16,90 €", after: "13,90 €", real_variation: "-18 %" },
  ]);

  // A price increase removes the struck-through price; an amount rule works on a product list.
  const up = await executeTool(
    "propose_price_rule",
    { label: "+2 €", reason: "Hausse", scope: { type: "products", product_ids: ["p3"] }, operation: "amount", value: 2, show_compare_at: true },
    ctx,
  );
  assert.ok(up.deliverable && up.deliverable.type === "price_update");
  assert.deepEqual(up.deliverable.changes, [{ productId: "p3", productTitle: "Miel de sidr 250g", before: 39, after: 41, compareAtAfter: null }]);
});

test("propose_price_rule refuses unknown scopes, absurd rules and rules that change nothing", async () => {
  const ctx = { agentId: "webmaster" as const, store: createDemoStore() };
  const base = { label: "x", reason: "x" };
  const unknownCategory = await executeTool("propose_price_rule", { ...base, scope: { type: "category", category: "Bijoux" }, operation: "percent", value: -10 }, ctx);
  assert.equal(unknownCategory.isError, true);
  assert.ok(unknownCategory.content.includes("Huiles"), "the error lists the real categories");
  for (const input of [
    { ...base, scope: { type: "all" }, operation: "percent", value: -95 },
    { ...base, scope: { type: "all" }, operation: "amount", value: -50 },
    { ...base, scope: { type: "all" }, operation: "set", value: 0 },
    { ...base, scope: { type: "products", product_ids: ["zzz"] }, operation: "percent", value: -10 },
    { ...base, scope: { type: "products", product_ids: [] }, operation: "percent", value: -10 },
    { ...base, scope: { type: "all" }, operation: "percent", value: 0 },
  ]) {
    const result = await executeTool("propose_price_rule", input, ctx);
    assert.equal(result.isError, true, JSON.stringify(input));
    assert.equal(result.deliverable, undefined);
  }
});

test("propose_discount_code validates the code and its conditions", async () => {
  const store = createDemoStore();
  const ctx = { agentId: "webmaster" as const, store };
  const ok = await executeTool(
    "propose_discount_code",
    { code: " bienvenue10 ", kind: "percentage", value: 10, minimum_purchase: 30, once_per_customer: true, ends_on: "2026-12-31", reason: "Bienvenue" },
    ctx,
  );
  const d = ok.deliverable;
  assert.ok(d && d.type === "discount" && d.status === "pending");
  assert.deepEqual(d.discount, {
    code: "BIENVENUE10",
    kind: "percentage",
    value: 10,
    appliesTo: "Toute la boutique",
    minimumPurchase: 30,
    endsOn: "2026-12-31",
    oncePerCustomer: true,
  });
  assert.equal(describeDiscount(d.discount), "-10 % · Toute la boutique · dès 30 € d'achat · une fois par client · jusqu'au 31/12/2026");

  const shipping = await executeTool("propose_discount_code", { code: "LIVRAISON", kind: "free_shipping", value: 99, scope: { type: "category", category: "Coffrets" }, reason: "r" }, ctx);
  assert.ok(shipping.deliverable && shipping.deliverable.type === "discount");
  assert.equal(shipping.deliverable.discount.value, 0);
  assert.equal(describeDiscount(shipping.deliverable.discount), "Livraison offerte · Catégorie Coffrets");

  store.discounts.push({ id: "x", ...d.discount });
  for (const input of [
    { code: "BIENVENUE10", kind: "percentage", value: 5, reason: "doublon" },
    { code: "été 2026", kind: "percentage", value: 5, reason: "caractères" },
    { code: "AB", kind: "percentage", value: 5, reason: "trop court" },
    { code: "TROP", kind: "percentage", value: 95, reason: "trop fort" },
    { code: "ZERO", kind: "fixed_amount", value: 0, reason: "nul" },
    { code: "DATE", kind: "percentage", value: 5, ends_on: "31/12/2026", reason: "date" },
  ]) {
    const result = await executeTool("propose_discount_code", input, ctx);
    assert.equal(result.isError, true, JSON.stringify(input));
  }
});

test("propose_announcement_bar keeps 1 to 4 short messages", async () => {
  const ctx = { agentId: "webmaster" as const, store: createDemoStore() };
  const ok = await executeTool("propose_announcement_bar", { messages: [" Livraison offerte dès 49 € ", ""], scrolling: true, reason: "r" }, ctx);
  assert.ok(ok.deliverable && ok.deliverable.type === "announcement");
  assert.deepEqual(ok.deliverable.bar, { messages: ["Livraison offerte dès 49 €"], scrolling: true, link: "" });
  assert.equal((await executeTool("propose_announcement_bar", { messages: [], scrolling: true, reason: "r" }, ctx)).isError, true);
  assert.equal((await executeTool("propose_announcement_bar", { messages: ["x".repeat(91)], scrolling: false, reason: "r" }, ctx)).isError, true);
  assert.equal((await executeTool("propose_announcement_bar", { messages: ["a", "b", "c", "d", "e"], scrolling: false, reason: "r" }, ctx)).isError, true);
});

test("approved changes apply to the shop; other agents can read active codes but not create them", async () => {
  let store = createDemoStore();
  const ctx = () => ({ agentId: "webmaster" as const, store });
  const approve = async (name: string, input: unknown) => {
    const result = await executeTool(name, input, ctx());
    assert.equal(result.isError, false, result.content);
    store = applyChange(store, result.deliverable as StoreChange);
  };
  await approve("propose_price_rule", { label: "Soldes", reason: "r", scope: { type: "category", category: "Huiles" }, operation: "percent", value: -15, rounding: "0.90" });
  await approve("propose_discount_code", { code: "BIENVENUE10", kind: "percentage", value: 10, reason: "r" });
  await approve("propose_announcement_bar", { messages: ["Livraison offerte dès 49 €"], scrolling: true, reason: "r" });
  await approve("propose_product_update", { product_id: "p2", reason: "r", tags: ["savon", "alep", "laurier"] });

  const nigelle = store.products.find((p) => p.id === "p1")!;
  assert.deepEqual([nigelle.price, nigelle.compareAtPrice, nigelle.updatedByAi], [12.9, 14.9, true]);
  assert.equal(store.products.find((p) => p.id === "p3")!.price, 39, "products outside the scope are untouched");
  assert.deepEqual(store.discounts.map((d) => d.code), ["BIENVENUE10"]);
  assert.deepEqual(store.announcement, { messages: ["Livraison offerte dès 49 €"], scrolling: true, link: "" });
  assert.deepEqual(store.products.find((p) => p.id === "p2")!.tags, ["savon", "alep", "laurier"]);
  assert.equal(createDemoStore().products[0].price, 14.9, "the original demo data is not mutated");

  const settings = await executeTool("get_store_settings", {}, { agentId: "email", store });
  assert.deepEqual(JSON.parse(settings.content), {
    discount_codes: [{ code: "BIENVENUE10", rule: "-10 % · Toute la boutique" }],
    announcement_bar: { messages: ["Livraison offerte dès 49 €"], scrolling: true, link: "" },
  });
  for (const agentId of ["seo", "email", "social"] as const) {
    const denied = await executeTool("propose_discount_code", { code: "PIRATE", kind: "percentage", value: 50, reason: "r" }, { agentId, store });
    assert.equal(denied.isError, true, agentId);
  }
});

test("the Webmaster demo picks its script from the request", async () => {
  const cases: [string, string][] = [
    ["Baisse de 15 % les prix de la catégorie Huiles, arrondis à ,90", "price_update"],
    ["Crée un code promo BIENVENUE10 : -10 % dès 30 € d'achat, une fois par client", "discount"],
    ["Ajoute une barre défilante : livraison offerte dès 49 € d'achat", "announcement"],
    ["Réécris la fiche de l'huile de nigelle pour qu'elle donne envie d'acheter", "product_update"],
  ];
  for (const [message, type] of cases) {
    const events: StreamEvent[] = [];
    await runMockAgent({ request: request("webmaster", message), emit: (e) => events.push(e), speed: 0 });
    assert.deepEqual(events.filter((e) => e.type === "tool_end" && !e.ok), [], message);
    assert.deepEqual(events.filter((e) => e.type === "deliverable").map((e) => e.deliverable.type), [type], message);
  }
  // The recap quotes the prices the tool really computed.
  const events: StreamEvent[] = [];
  await runMockAgent({ request: request("webmaster", "Baisse les prix des huiles"), emit: (e) => events.push(e), speed: 0 });
  const priced = events.find((e) => e.type === "deliverable")!.deliverable;
  assert.ok(priced.type === "price_update");
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  for (const c of priced.changes) assert.ok(text.includes(`${c.after.toFixed(2).replace(".", ",")} €`), `recap misses ${c.after}`);
});

test("Search Console exports are read in French and in English, with quoted cells", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n\n'), [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);

  const french = parseSearchCsv('\uFEFFRequêtes les plus fréquentes,Clics,Impressions,CTR,Position\n"savon d\'alep, 200 g",52,"8 200","0,63 %","14,6"\nhuile de nigelle,38,5400,0.7%,11.2\n');
  assert.ok(french.kind === "queries");
  assert.deepEqual(french.rows[0], { query: "savon d'alep, 200 g", clicks: 52, impressions: 8200, ctr: 52 / 8200, position: 14.6 });
  assert.deepEqual(french.rows[1], { query: "huile de nigelle", clicks: 38, impressions: 5400, ctr: 38 / 5400, position: 11.2 });

  const english = parseSearchCsv("Top pages,Clicks,Impressions,CTR,Position\nhttps://shop.test/a,10,200,5%,3.4\n");
  assert.ok(english.kind === "pages");
  assert.deepEqual(english.rows, [{ url: "https://shop.test/a", clicks: 10, impressions: 200, ctr: 0.05, position: 3.4 }]);

  // The other tabs of the export (countries, devices, dates) are ignored.
  assert.equal(parseSearchCsv("Pays,Clics,Impressions,CTR,Position\nFrance,1,2,50%,1\n").kind, "other");
  assert.equal(parseSearchCsv("Date,Clics\n2026-01-01,3\n").kind, "other");
  assert.equal(parseSearchCsv("").kind, "other");

  const perf = buildSearchPerformance(
    [
      { name: "Pays.csv", text: "Pays,Clics,Impressions,CTR,Position\nFrance,1,2,50%,1\n" },
      { name: "Pages.csv", text: "Top pages,Clicks,Impressions,CTR,Position\nhttps://shop.test/a,10,200,5%,3.4\n" },
      { name: "Requêtes.csv", text: "Top queries,Clicks,Impressions,CTR,Position\npetite,1,10,10%,2\ngrande,5,900,0.5%,8\n" },
    ],
    "11 novembre 2026",
  );
  assert.equal(perf.source, "import");
  assert.equal(perf.period, "Export importé le 11 novembre 2026");
  assert.deepEqual(perf.queries.map((q) => q.query), ["grande", "petite"], "sorted by impressions");
  assert.equal(perf.pages.length, 1);
  assert.throws(() => buildSearchPerformance([{ name: "Pays.csv", text: "Pays,Clics,Impressions,CTR,Position\nFrance,1,2,50%,1\n" }], "x"), SearchImportError);
});

test("search findings: totals, brand share, queries within reach, weak click rates", () => {
  const store = createDemoStore();
  const insights = analyzeSearch(store.search!, store.name);
  assert.deepEqual(insights.totals, { clicks: 753, impressions: 51830, ctr: 753 / 51830, position: 12.7, brandShare: 190 / 753 });
  assert.deepEqual(insights.quickWins.slice(0, 3).map((q) => q.query), ["savon d'alep", "huile de nigelle", "ghassoul cheveux"]);
  assert.ok(insights.quickWins.every((q) => q.position >= 4 && q.position <= 15 && !q.query.includes("maison nour")));
  assert.deepEqual(insights.lowCtr.map((q) => q.query), ["miel de sidr", "coffret hammam cadeau", "miel de sidr yemen prix"]);
  assert.deepEqual(insights.farBehind.slice(0, 2).map((q) => q.query), ["huile d'argan bio", "savon noir hammam"]);
  assert.equal(insights.topQueries[0].query, "maison nour");
  assert.equal(insights.topPages[0].url, "https://maison-nour.example/");
  assert.equal(formatPercent(0.0145), "1,5 %");
  assert.equal(formatPosition(12.66), "12,7");
});

test("the SEO report takes its figures from the data, and needs data to exist", async () => {
  const store = createDemoStore();
  const ctx = { agentId: "seo" as const, store };
  const read = await executeTool("get_search_performance", {}, ctx);
  const data = JSON.parse(read.content);
  assert.equal(data.source, "données de démonstration");
  assert.deepEqual(data.totals, { clicks: 753, impressions: 51830, ctr: "1,5 %", average_position: "12,7", share_of_clicks_from_brand_queries: "25,2 %" });
  assert.equal(data.within_reach_positions_4_to_15[0].query, "savon d'alep");

  const report = await executeTool(
    "create_seo_report",
    { title: "Rapport", summary: "Lecture.", actions: [{ priority: "haute", action: "Réécrire", target: "savon d'alep", reason: "8 200 impressions" }] },
    ctx,
  );
  const d = report.deliverable;
  assert.ok(d && d.type === "seo_report");
  assert.equal(d.source, "demo");
  assert.equal(d.totals.clicks, 753);
  assert.equal(d.quickWins[0].query, "savon d'alep");
  assert.equal(d.actions.length, 1);

  const empty = { agentId: "seo" as const, store: { ...store, search: null } };
  assert.equal((await executeTool("get_search_performance", {}, empty)).isError, true);
  assert.equal((await executeTool("create_seo_report", { title: "x", summary: "x", actions: [] }, empty)).isError, true);
  assert.equal((await executeTool("create_seo_report", { title: "x", summary: "x", actions: [] }, ctx)).isError, true);
  // Only the SEO agent reads search data.
  assert.equal((await executeTool("get_search_performance", {}, { agentId: "email", store })).isError, true);
});

test("the demo SEO report quotes the figures the data really gives", async () => {
  const events: StreamEvent[] = [];
  await runMockAgent({ request: request("seo", "Fais mon rapport SEO à partir des données Search Console"), emit: (e) => events.push(e), speed: 0 });
  assert.deepEqual(events.filter((e) => e.type === "tool_end" && !e.ok), []);
  const report = events.find((e) => e.type === "deliverable")!.deliverable;
  assert.ok(report.type === "seo_report");
  const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
  const chat = plain(events.filter((e) => e.type === "text").map((e) => e.delta).join(""));
  const { totals } = report;
  for (const figure of [formatPercent(totals.ctr), formatPosition(totals.position)]) {
    assert.ok(chat.includes(plain(figure)), `chat recap misses ${figure}`);
    assert.ok(plain(report.summary).includes(plain(figure)), `report summary misses ${figure}`);
  }
  assert.ok(plain(report.summary).includes(plain(totals.impressions.toLocaleString("fr-FR"))));
  // Every query named in an action exists in the data, with the impressions quoted.
  const store = createDemoStore();
  for (const [query, impressions] of [["savon d'alep", "8 200"], ["huile de nigelle", "5 400"], ["huile d'argan bio", "6 100"], ["ghassoul cheveux", "3 600"]] as const) {
    const row = store.search!.queries.find((q) => q.query === query)!;
    assert.equal(plain(row.impressions.toLocaleString("fr-FR")), impressions);
    assert.ok(report.actions.some((a) => a.target.includes(query) && plain(a.reason).includes(impressions)), query);
  }
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

  // Every agent gets the client's brand brief, its own method and the shared writing rules.
  const markers = { webmaster: "### Fiches produits", seo: "### Balises", email: "### Séquences", social: "### Vidéos courtes" } as const;
  for (const agentId of AGENT_IDS) {
    const p = systemPrompt(agentId, store);
    assert.ok(p.includes(store.brand.voice) && p.includes(store.brand.facts) && p.includes(store.brand.avoid), `${agentId}: brand brief missing`);
    assert.ok(p.includes(markers[agentId]), `${agentId}: method missing`);
    assert.ok(p.includes("Pars du client, pas du produit"), `${agentId}: writing rules missing`);
    for (const [other, marker] of Object.entries(markers)) {
      if (other !== agentId) assert.equal(p.includes(marker), false, `${agentId} must not carry the ${other} method`);
    }
  }
  // The brief is the client's: editing it changes what the agent is told, and gaps are said, not filled.
  const edited = { ...store, brand: { ...store.brand, voice: "On tutoie, ton complice.", facts: "" } };
  const editedPrompt = systemPrompt("email", edited);
  assert.ok(editedPrompt.includes("Sa voix : On tutoie, ton complice."));
  assert.ok(editedPrompt.includes("Informations pratiques vérifiées : non renseigné par le client"));
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
