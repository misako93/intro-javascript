// Parcours complet de l'application dans un vrai navigateur, en mode démo
// (aucune clé API : les agents rejouent des scénarios préenregistrés).
//
// Prérequis, une seule fois :   npm i -D playwright && npx playwright install chromium
// Lancer l'application sans clé : DEMO_MODE=1 npm run build && DEMO_MODE=1 npm start
// Puis :                         node tests/e2e/demo.e2e.js
// Les captures d'écran vont dans test-results/shots/.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "../../test-results/shots");
fs.mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

async function runAgent(page, navLabel, suggestionIndex = 0) {
  await page.locator(".nav-item", { hasText: navLabel }).click();
  await page.locator(".suggestion").nth(suggestionIndex).click();
  // The stop button is shown while the agent works, the send button after.
  await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await page.locator(".msg-error").count(), 0, `${navLabel}: error shown in chat`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(BASE);
  await page.locator(".agent-card").first().waitFor();
  await page.locator(".demo-banner").waitFor();
  assert.equal(await page.locator(".agent-card").count(), 4);
  const scoreBefore = Number(await page.locator(".stat-score .score-ring span").innerText());
  await shot(page, "01-dashboard");

  // --- SEO agent: audit + two proposals
  await runAgent(page, "SEO");
  assert.equal(await page.locator(".panel .deliverable-card").count(), 3);
  assert.equal(await page.locator(".panel .status-pending").count(), 2);
  // Unused suggestions stay one click away once the conversation has started.
  assert.equal(await page.locator(".quick .chip").count(), 3);
  await shot(page, "02-seo-chat");

  await page.locator(".panel .deliverable-card", { hasText: "Audit SEO du catalogue" }).click();
  await page.locator(".modal .audit-row").first().waitFor();
  assert.equal(await page.locator(".modal .audit-row").count(), 8);
  await shot(page, "03-seo-audit");
  await page.keyboard.press("Escape");
  await page.locator(".modal").waitFor({ state: "detached" });

  // Open a proposal, check the diff, approve it from the modal.
  await page.locator(".panel .deliverable-card", { hasText: "Huile nigelle" }).click();
  await page.locator(".modal .diff").first().waitFor();
  assert.equal(await page.locator(".modal .diff").count(), 2);
  await shot(page, "04-proposal");
  await page.locator(".modal-foot .btn-approve").click();
  await page.locator(".modal .status-approved").waitFor();
  await page.keyboard.press("Escape");

  // Reject the other one straight from the card.
  await page.locator(".panel .btn-reject").first().click();
  assert.equal(await page.locator(".panel .status-pending").count(), 0);
  assert.equal(await page.locator(".panel .status-rejected").count(), 1);

  // --- SEO report built on the Search Console data
  await page.locator(".quick .chip", { hasText: "Fais mon rapport SEO" }).click();
  await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await page.locator(".msg-error").count(), 0);
  await page.locator(".panel .deliverable-card", { hasText: "Rapport SEO — 3 derniers mois" }).click();
  await page.locator(".modal .kpis").waitFor();
  const kpis = (await page.locator(".modal .kpis").innerText()).replace(/[\u00a0\u202f]/g, " ");
  assert.ok(kpis.includes("753") && kpis.includes("51 830") && kpis.includes("1,5 %") && kpis.includes("12,7") && kpis.includes("25,2 %"), kpis);
  assert.equal(await page.locator(".modal .priority").count(), 7);
  assert.equal(await page.locator(".modal .priority-haute").count(), 3);
  // Long reports scroll inside the window; tables keep their full height.
  const planRows = page.locator(".modal .table").first().locator("tbody tr");
  assert.equal(await planRows.count(), 7);
  const table = await page.locator(".modal .table-wrap").first().boundingBox();
  assert.ok(table.height > 7 * 40, `action plan table is squeezed: ${Math.round(table.height)}px`);
  await shot(page, "17-seo-report");
  await page.locator(".modal .table-wrap").nth(1).scrollIntoViewIfNeeded();
  await shot(page, "17b-seo-report-tables");
  await page.keyboard.press("Escape");
  await page.locator(".modal").waitFor({ state: "detached" });

  // --- Search Console screen: demo data, then a real export file, then back
  await page.locator(".nav-item", { hasText: "Search Console" }).click();
  await page.locator(".import-box", { hasText: "Données de démonstration" }).waitFor();
  await shot(page, "18-search-console");
  const { zipSync, strToU8 } = require("fflate");
  const zipPath = path.join(OUT, "export-search-console.zip");
  fs.writeFileSync(
    zipPath,
    zipSync({
      "Requêtes.csv": strToU8("Requêtes les plus fréquentes,Clics,Impressions,CTR,Position\nabaya noire,120,4000,3%,6.2\nhijab jersey,40,9000,0.44%,12.5\n"),
      "Pages.csv": strToU8("Pages les plus populaires,Clics,Impressions,CTR,Position\nhttps://exemple.fr/abaya,150,6000,2.5%,7\n"),
      "Pays.csv": strToU8("Pays,Clics,Impressions,CTR,Position\nFrance,160,13000,1.2%,9\n"),
    }),
  );
  await page.locator("#search-export").setInputFiles(zipPath);
  await page.locator(".import-box", { hasText: "Vos données Search Console" }).waitFor();
  const imported = (await page.locator(".page").innerText()).replace(/[\u00a0\u202f]/g, " ");
  assert.ok(imported.includes("abaya noire") && imported.includes("hijab jersey") && imported.includes("/abaya"), "imported rows not shown");
  assert.ok(imported.includes("13 000") && imported.includes("160"), "imported totals not shown");
  assert.equal(imported.includes("savon d'alep"), false, "demo data must be replaced");
  // A file that is not an export is refused with a clear message, and the data is kept.
  const badPath = path.join(OUT, "pas-un-export.csv");
  fs.writeFileSync(badPath, "nom,age\nA,3\n");
  await page.locator("#search-export").setInputFiles(badPath);
  await page.locator(".import-box .msg-error").waitFor();
  assert.ok((await page.locator(".page").innerText()).includes("abaya noire"));
  await page.locator(".btn", { hasText: "Revenir aux données de démonstration" }).click();
  await page.locator(".import-box", { hasText: "Données de démonstration" }).waitFor();

  // --- Catalogue reflects the approved change
  await page.locator(".nav-item", { hasText: "Catalogue" }).click();
  const first = page.locator(".product").first();
  await first.locator(".ai-badge").waitFor();
  await first.locator("summary").click();
  const seoText = await first.locator(".seo-fields").innerText();
  assert.ok(seoText.includes("Huile de nigelle pure pressée à froid 100 ml | Maison Nour"), "approved SEO title not applied");
  assert.equal(await page.locator(".product").nth(2).locator(".ai-badge").count(), 0, "rejected proposal must not be applied");
  const scoreAfter = Number(await page.locator(".head-score .score-ring span").innerText());
  assert.ok(scoreAfter > scoreBefore, `score should rise after approval (${scoreBefore} -> ${scoreAfter})`);
  await shot(page, "05-catalogue");

  // --- Emailing agent
  await runAgent(page, "Emailing");
  assert.equal(await page.locator(".panel .deliverable-card").count(), 2);
  await page.locator(".panel .deliverable-card").last().click();
  const frame = page.frameLocator(".email-frame");
  await frame.locator("a", { hasText: "Découvrir la sélection" }).waitFor();
  await shot(page, "06-email");
  await page.keyboard.press("Escape");

  // --- Social / video agent
  await runAgent(page, "Réseaux");
  await page.locator(".panel .deliverable-card", { hasText: "test de la cuillère" }).click();
  await page.locator(".modal .table tbody tr").first().waitFor();
  assert.equal(await page.locator(".modal .table tbody tr").count(), 5);
  await shot(page, "07-video");
  await page.keyboard.press("Escape");

  // --- Webmaster agent
  await runAgent(page, "Webmaster");
  assert.equal(await page.locator(".panel .status-pending").count(), 1);
  await shot(page, "08-webmaster");

  // --- Webmaster: everyday shop operations, each approved then checked on the site preview
  const quick = async (text) => {
    await page.locator(".quick .chip", { hasText: text }).click();
    await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
    assert.equal(await page.locator(".msg-error").count(), 0, `error after: ${text}`);
  };
  assert.equal(await page.locator(".quick .chip").count(), 4);
  await quick("Baisse de 15 %");
  await page.locator(".panel .deliverable-card", { hasText: "-15 % sur les Huiles" }).click();
  await page.locator(".modal .table tbody tr").first().waitFor();
  assert.equal(await page.locator(".modal .table tbody tr").count(), 2);
  await shot(page, "13-price-rule");
  await page.locator(".modal-foot .btn-approve").click();
  await page.locator(".modal .status-approved").waitFor();
  await page.keyboard.press("Escape");

  await quick("Crée un code promo");
  await page.locator(".panel .deliverable-card", { hasText: "Code promo BIENVENUE10" }).locator(".btn-approve").click();

  await quick("Ajoute une barre défilante");
  await page.locator(".panel .deliverable-card", { hasText: "Barre d'annonce" }).click();
  await page.locator(".modal .announce-track").waitFor();
  await shot(page, "14-announcement");
  await page.locator(".modal-foot .btn-approve").click();
  await page.locator(".modal .status-approved").waitFor();
  await page.keyboard.press("Escape");
  // Only the product rewrite from the first request is still waiting.
  assert.equal(await page.locator(".panel .status-pending").count(), 1);
  assert.equal(await page.locator(".panel .status-approved").count(), 3);

  await page.locator(".nav-item", { hasText: "Aperçu du site" }).click();
  await page.locator(".browser .announce-track").waitFor();
  assert.ok((await page.locator(".browser .announce").innerText()).includes("Livraison offerte dès 49 € d'achat"));
  assert.equal(await page.locator(".sf-badge").count(), 2);
  const firstCard = await page.locator(".sf-card").first().innerText();
  assert.ok(firstCard.includes("12,90") && firstCard.includes("14,90") && firstCard.includes("-13 %"), firstCard);
  assert.equal(await page.locator(".sf-card").nth(2).locator(".sf-badge").count(), 0, "products outside the rule keep their price");
  assert.equal(await page.locator(".coupon-code").innerText(), "BIENVENUE10");
  await shot(page, "15-storefront");

  // --- Global deliverables page + dashboard counters
  await page.locator(".nav-item", { hasText: "Livrables" }).click();
  assert.equal(await page.locator(".deliverable-grid .deliverable-card").count(), 12);
  await shot(page, "09-livrables");
  await page.locator(".nav-item", { hasText: "Tableau de bord" }).click();
  await page.locator(".stat").nth(1).waitFor();
  assert.equal((await page.locator(".stat").nth(1).locator(".stat-value").innerText()).trim(), "1");
  assert.equal((await page.locator(".stat").nth(2).locator(".stat-value").innerText()).trim(), "12");
  await shot(page, "10-dashboard-after");

  // --- Brand brief: editable, saved, and sent to the agents with the next request
  await page.locator(".nav-item", { hasText: "Brief de marque" }).click();
  assert.equal(await page.locator(".brief-field textarea").count(), 5);
  assert.ok((await page.locator("#brand-facts").inputValue()).includes("Livraison offerte dès 49 €"));
  await shot(page, "16-brand");
  await page.locator("#brand-voice").fill("On tutoie. Ton complice et direct.");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/chat") && r.method() === "POST");
  await page.locator(".nav-item", { hasText: "Emailing" }).click();
  await page.locator(".quick .chip").first().click();
  assert.equal((await sent).postDataJSON().store.brand.voice, "On tutoie. Ton complice et direct.");
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await page.locator(".msg-error").count(), 0);

  // --- State survives a reload, conversation included
  await page.waitForTimeout(500);
  await page.reload();
  // The open screen is kept across a reload; go back to the dashboard for the counters.
  await page.locator(".chat-head").waitFor();
  await page.locator(".nav-item", { hasText: "Tableau de bord" }).click();
  await page.locator(".stat").nth(2).waitFor();
  assert.equal((await page.locator(".stat").nth(2).locator(".stat-value").innerText()).trim(), "14");
  await page.locator(".nav-item", { hasText: "Brief de marque" }).click();
  assert.equal(await page.locator("#brand-voice").inputValue(), "On tutoie. Ton complice et direct.", "brand brief lost on reload");
  await page.locator(".nav-item", { hasText: "SEO" }).click();
  assert.ok((await page.locator(".msg-assistant").count()) >= 1, "chat history lost on reload");

  // --- Phone layout
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (e) => problems.push(`mobile pageerror: ${e.message}`));
  await mobile.goto(BASE);
  await mobile.locator(".agent-card").first().waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `horizontal overflow on phone: ${overflow}px`);
  await shot(mobile, "11-mobile-dashboard");
  await mobile.locator(".nav-item").nth(2).click();
  await mobile.locator(".suggestion").first().click();
  await mobile.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  await shot(mobile, "12-mobile-chat");
  // A quick suggestion starts a second turn in the same conversation.
  await mobile.locator(".quick .chip").first().click();
  await mobile.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await mobile.locator(".quick").count(), 0, "suggestions hide while the agent works");
  await mobile.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await mobile.locator(".msg-user").count(), 2);
  assert.equal(await mobile.locator(".msg-error").count(), 0);
  assert.equal(await mobile.locator(".quick .chip").count(), 2);
  const overflow2 = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow2 <= 1, `horizontal overflow on phone chat: ${overflow2}px`);

  await browser.close();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`E2E OK — score ${scoreBefore} -> ${scoreAfter}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
