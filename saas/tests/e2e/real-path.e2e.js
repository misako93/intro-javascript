// Parcours hors mode démo : le vrai SDK Claude et la vraie boucle d'agent,
// contre le faux serveur local tests/fake-claude.ts (aucun crédit dépensé).
//
// Prérequis, une seule fois :   npm i -D playwright && npx playwright install chromium
// Dans trois terminaux, après « npm run build » :
//   FAKE_PORT=4010 FAKE_DELAY_MS=90 npx tsx tests/fake-claude.ts
//   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ACCESS_CODE=webinaire npx next start -p 3001
//   ANTHROPIC_API_KEY=sk-invalid ANTHROPIC_BASE_URL=http://127.0.0.1:4010 npx next start -p 3002
// Puis :                         node tests/e2e/real-path.e2e.js
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const OUT = path.join(__dirname, "../../test-results/shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  // The 401 on the first status/chat call is expected while the code is wrong.
  page.on("console", (m) => m.type() === "error" && !m.text().includes("401") && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  // --- Access gate
  await page.goto("http://localhost:3001");
  await page.locator(".gate-card").waitFor();
  assert.equal(await page.locator(".shell").count(), 0, "app must not render before the code is accepted");
  await page.locator("#access-code").fill("mauvais");
  await page.locator(".gate-card button").click();
  await page.locator(".gate-card .msg-error").waitFor();
  await page.locator("#access-code").fill("webinaire");
  await page.locator(".gate-card button").click();
  await page.locator(".agent-card").first().waitFor();
  assert.equal(await page.locator(".demo-banner").count(), 0, "no demo banner when a key is configured");
  await page.screenshot({ path: path.join(OUT, "20-real-dashboard.png") });

  // --- Each agent, through the real streaming path
  const runs = [
    ["Webmaster", "Fiche « Savon Alep 200g »"],
    ["SEO", "Fiche « Savon Alep 200g »"],
    ["Emailing", "Relance panier — rappel simple"],
    ["Réseaux", "Savon d'Alep — la coupe"],
  ];
  for (const [label, title] of runs) {
    await page.locator(".nav-item", { hasText: label }).click();
    await page.locator(".suggestion").first().click();
    await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
    // While the tool input streams, the chip shows a live character count.
    await page.locator(".tool-running", { hasText: "caractères" }).waitFor({ timeout: 15000 });
    await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
    assert.equal(await page.locator(".msg-error").count(), 0, `${label}: error in chat`);
    assert.equal(await page.locator(".tool-ok").count(), 2, `${label}: two tools should have succeeded`);
    assert.equal(await page.locator(".panel .deliverable-card", { hasText: title }).count(), 1, `${label}: deliverable missing`);
    const text = await page.locator(".msg-assistant .markdown").allInnerTexts();
    assert.deepEqual(text.map((t) => t.trim()), ["Je lis d'abord votre catalogue.", "C'est prêt : le livrable vous attend. Prochaine étape : dites-moi si je continue."], label);
  }
  await page.screenshot({ path: path.join(OUT, "21-real-social.png") });

  // --- Second turn in the same conversation: history is sent back as text
  await page.locator(".composer textarea").fill("Continue avec le produit suivant");
  await page.keyboard.press("Enter");
  await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await page.locator(".msg-user").count(), 2);
  assert.equal(await page.locator(".msg-error").count(), 0);
  assert.equal(await page.locator(".panel .deliverable-card").count(), 2);

  // --- Stop button: the turn ends quietly, no error bubble
  await page.locator(".nav-item", { hasText: "Emailing" }).click();
  await page.locator(".composer textarea").fill("Encore un email");
  await page.keyboard.press("Enter");
  await page.locator(".tool-running").waitFor({ timeout: 15000 });
  await page.locator(".btn-stop").click();
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 10000 });
  assert.equal(await page.locator(".msg-error").count(), 0, "stopping must not show an error");
  assert.equal(await page.locator(".tool-running").count(), 0, "no spinner left after stop");
  // The composer works again right away.
  await page.locator(".composer textarea").fill("Reprends");
  await page.keyboard.press("Enter");
  await page.locator(".btn-stop").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".btn-stop").waitFor({ state: "detached", timeout: 60000 });
  assert.equal(await page.locator(".msg-error").count(), 0);

  // --- Rejected API key: a readable message, in the chat
  const bad = await context.newPage();
  await bad.goto("http://localhost:3002/#/agent:seo");
  await bad.locator(".suggestion").first().click();
  await bad.locator(".msg-error").waitFor({ timeout: 30000 });
  const message = await bad.locator(".msg-error").innerText();
  assert.equal(message, "La clé API Claude est refusée. Vérifiez la variable ANTHROPIC_API_KEY.");
  assert.equal(await bad.locator(".btn-stop").count(), 0);
  await bad.screenshot({ path: path.join(OUT, "22-bad-key.png") });

  await browser.close();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("E2E real path OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
