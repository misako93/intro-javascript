import dns from "node:dns/promises";
import net from "node:net";
import { parse } from "node-html-parser";
import type { AuditCheck } from "../types";

// Fetching a URL chosen by a user (or by the model) from the server is a
// classic SSRF vector, so only plain public web pages are allowed.

export class PageAuditError extends Error {}

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true;
  if (family === 4) return blocked.check(ip, "ipv4");
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  return blocked.check(ip, "ipv6");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PageAuditError("URL invalide. Exemple attendu : https://www.maboutique.fr/produit");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageAuditError("Seules les adresses http(s) peuvent être auditées.");
  }
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
    throw new PageAuditError("Cette adresse n'est pas une page web publique.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new PageAuditError(`Nom de domaine introuvable : ${host}`);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new PageAuditError("Cette adresse n'est pas une page web publique.");
  }
  return url;
}

const MAX_BYTES = 2_000_000;

export async function fetchPublicHtml(raw: string): Promise<{ html: string; finalUrl: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SiteAuditBot/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw new PageAuditError(`La page ne répond pas : ${url.href}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new PageAuditError("Redirection sans destination.");
      // Every hop is re-validated: a public URL may redirect to a private one.
      url = await assertPublicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      throw new PageAuditError(`La page répond avec une erreur ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      throw new PageAuditError("Cette adresse ne renvoie pas une page HTML.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PageAuditError("Page vide.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: url.href };
  }
  throw new PageAuditError("Trop de redirections.");
}

export function analyzeHtml(html: string, pageUrl: string): { score: number; checks: AuditCheck[] } {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const checks: AuditCheck[] = [];
  const add = (status: AuditCheck["status"], label: string, detail: string) =>
    checks.push({ status, label, detail });

  const title = root.querySelector("title")?.text.trim() ?? "";
  if (!title) add("error", "Balise title", "Absente : c'est le premier signal lu par Google.");
  else if (title.length > 60) add("warn", "Balise title", `${title.length} caractères, coupée au-delà de 60 : « ${title} »`);
  else if (title.length < 25) add("warn", "Balise title", `Très courte (${title.length} caractères) : « ${title} »`);
  else add("ok", "Balise title", `« ${title} » (${title.length} caractères)`);

  const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  if (!description) add("error", "Meta description", "Absente : Google choisira un extrait à votre place.");
  else if (description.length > 160 || description.length < 110)
    add("warn", "Meta description", `${description.length} caractères : visez 140 à 155.`);
  else add("ok", "Meta description", `${description.length} caractères.`);

  const h1 = root.querySelectorAll("h1");
  if (h1.length === 0) add("error", "Titre H1", "Aucun H1 sur la page.");
  else if (h1.length > 1) add("warn", "Titre H1", `${h1.length} H1 : gardez-en un seul.`);
  else add("ok", "Titre H1", `« ${h1[0].text.trim().slice(0, 90)} »`);

  const h2 = root.querySelectorAll("h2").length;
  if (h2 === 0) add("warn", "Sous-titres H2", "Aucun H2 : le contenu n'est pas structuré.");
  else add("ok", "Sous-titres H2", `${h2} sous-titre(s).`);

  const images = root.querySelectorAll("img");
  const missingAlt = images.filter((img) => !(img.getAttribute("alt") ?? "").trim()).length;
  if (images.length === 0) add("ok", "Images", "Aucune image détectée dans le HTML.");
  else if (missingAlt > 0)
    add(missingAlt > images.length / 2 ? "error" : "warn", "Textes alternatifs", `${missingAlt} image(s) sur ${images.length} sans attribut alt.`);
  else add("ok", "Textes alternatifs", `Les ${images.length} images ont un attribut alt.`);

  const words = (root.querySelector("body")?.text ?? "").split(/\s+/).filter(Boolean).length;
  if (words < 150) add("warn", "Contenu", `${words} mots visibles : contenu mince.`);
  else add("ok", "Contenu", `${words} mots visibles.`);

  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (canonical) add("ok", "URL canonique", canonical);
  else add("warn", "URL canonique", "Absente : risque de contenu dupliqué.");

  const robots = root.querySelector('meta[name="robots"]')?.getAttribute("content")?.toLowerCase() ?? "";
  if (robots.includes("noindex")) add("error", "Indexation", "La page est en noindex : Google ne l'affichera pas.");
  else add("ok", "Indexation", "Aucun blocage noindex.");

  if (root.querySelector('meta[name="viewport"]')) add("ok", "Mobile", "Balise viewport présente.");
  else add("warn", "Mobile", "Balise viewport absente.");

  if (root.querySelector("html")?.getAttribute("lang")) add("ok", "Langue", "Attribut lang déclaré.");
  else add("warn", "Langue", "Attribut lang absent sur la balise html.");

  const hasOg = root.querySelector('meta[property="og:title"]') && root.querySelector('meta[property="og:image"]');
  if (hasOg) add("ok", "Partage social", "Balises Open Graph présentes.");
  else add("warn", "Partage social", "Balises Open Graph incomplètes (og:title, og:image).");

  if (root.querySelector('script[type="application/ld+json"]')) add("ok", "Données structurées", "JSON-LD détecté.");
  else add("warn", "Données structurées", "Aucun JSON-LD : pas d'étoiles ni de prix dans les résultats.");

  if (pageUrl.startsWith("https://")) add("ok", "HTTPS", "Page servie en HTTPS.");
  else add("error", "HTTPS", "Page servie sans HTTPS.");

  const penalty = checks.reduce((sum, c) => sum + (c.status === "error" ? 15 : c.status === "warn" ? 6 : 0), 0);
  return { score: Math.max(0, 100 - penalty), checks };
}
