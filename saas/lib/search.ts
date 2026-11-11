import type { SearchPageRow, SearchPerformance, SearchQueryRow } from "./types";

// Search Console data: reading an export, and the fixed rules that turn it
// into findings. Like the SEO scores, every number shown to the client comes
// from here, never from the model.

// ---- Reading a Search Console export ---------------------------------------

/** Splits CSV text into rows of cells, honouring quoted cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** « 1 234 », « 5,2 % », « 12.3 » → number. Exports differ by interface language. */
function toNumber(value: string): number {
  const cleaned = value.replace(/[\s  %]/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class SearchImportError extends Error {}

type ParsedFile = { kind: "queries"; rows: SearchQueryRow[] } | { kind: "pages"; rows: SearchPageRow[] } | { kind: "other" };

/** Reads one CSV of a Search Console performance export (queries or pages tab). */
export function parseSearchCsv(text: string): ParsedFile {
  const rows = parseCsv(text);
  if (rows.length < 2) return { kind: "other" };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const first = header[0] ?? "";
  const column = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const clicks = column("clic", "click");
  const impressions = column("impression");
  const position = column("position");
  if (clicks < 0 || impressions < 0 || position < 0) return { kind: "other" };
  const metrics = (r: string[]) => {
    const c = toNumber(r[clicks] ?? "");
    const i = toNumber(r[impressions] ?? "");
    return { clicks: c, impressions: i, ctr: i > 0 ? c / i : 0, position: toNumber(r[position] ?? "") };
  };
  const body = rows.slice(1).filter((r) => (r[0] ?? "").trim());
  if (/requ|quer/.test(first)) return { kind: "queries", rows: body.map((r) => ({ query: r[0].trim(), ...metrics(r) })) };
  if (/page/.test(first)) return { kind: "pages", rows: body.map((r) => ({ url: r[0].trim(), ...metrics(r) })) };
  return { kind: "other" };
}

export const MAX_QUERIES = 300;
export const MAX_PAGES = 150;

/** Builds the performance data from the CSV files of an export. */
export function buildSearchPerformance(files: { name: string; text: string }[], importedOn: string): SearchPerformance {
  let queries: SearchQueryRow[] | null = null;
  let pages: SearchPageRow[] | null = null;
  for (const file of files) {
    const parsed = parseSearchCsv(file.text);
    if (parsed.kind === "queries") queries = parsed.rows;
    else if (parsed.kind === "pages") pages = parsed.rows;
  }
  if (!queries || queries.length === 0) {
    throw new SearchImportError(
      "Le fichier des requêtes est introuvable. Dans Search Console, ouvrez Performances, cliquez sur Exporter puis « Télécharger au format CSV », et déposez ici le fichier ZIP obtenu.",
    );
  }
  const byImpressions = <T extends { impressions: number }>(a: T, b: T) => b.impressions - a.impressions;
  return {
    source: "import",
    period: `Export importé le ${importedOn}`,
    queries: [...queries].sort(byImpressions).slice(0, MAX_QUERIES),
    pages: [...(pages ?? [])].sort(byImpressions).slice(0, MAX_PAGES),
  };
}

// ---- Findings ---------------------------------------------------------------

/**
 * Typical click-through rate by position on page one. These are orders of
 * magnitude from public studies, used only to spot a title that underperforms.
 */
const EXPECTED_CTR = [0.27, 0.16, 0.11, 0.08, 0.06, 0.05, 0.04, 0.033, 0.027, 0.024];

export function expectedCtr(position: number): number {
  const index = Math.min(Math.max(Math.round(position), 1), EXPECTED_CTR.length) - 1;
  return EXPECTED_CTR[index];
}

export interface SearchInsights {
  totals: { clicks: number; impressions: number; ctr: number; position: number; brandShare: number };
  /** Non-brand queries ranked 4 to 15: a push away from the top of page one. */
  quickWins: SearchQueryRow[];
  /** Well-ranked queries whose click rate is under half of what the position usually earns. */
  lowCtr: SearchQueryRow[];
  /** Queries people search a lot where the shop sits beyond position 15. */
  farBehind: SearchQueryRow[];
  topQueries: SearchQueryRow[];
  topPages: SearchPageRow[];
}

export function analyzeSearch(perf: SearchPerformance, storeName: string): SearchInsights {
  const brand = storeName.trim().toLowerCase();
  const isBrand = (q: SearchQueryRow) => brand.length > 2 && q.query.toLowerCase().includes(brand);
  const clicks = perf.queries.reduce((sum, q) => sum + q.clicks, 0);
  const impressions = perf.queries.reduce((sum, q) => sum + q.impressions, 0);
  const weightedPosition = perf.queries.reduce((sum, q) => sum + q.position * q.impressions, 0);
  const brandClicks = perf.queries.filter(isBrand).reduce((sum, q) => sum + q.clicks, 0);
  const generic = perf.queries.filter((q) => !isBrand(q));
  const byImpressions = (a: SearchQueryRow, b: SearchQueryRow) => b.impressions - a.impressions;
  return {
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: impressions > 0 ? Math.round((weightedPosition / impressions) * 10) / 10 : 0,
      brandShare: clicks > 0 ? brandClicks / clicks : 0,
    },
    quickWins: generic.filter((q) => q.position >= 4 && q.position <= 15).sort(byImpressions).slice(0, 8),
    lowCtr: generic
      .filter((q) => q.position <= 5.5 && q.impressions >= 100 && q.ctr < expectedCtr(q.position) / 2)
      .sort(byImpressions)
      .slice(0, 6),
    farBehind: generic.filter((q) => q.position > 15).sort(byImpressions).slice(0, 6),
    topQueries: [...perf.queries].sort((a, b) => b.clicks - a.clicks).slice(0, 10),
    topPages: [...perf.pages].sort((a, b) => b.clicks - a.clicks).slice(0, 8),
  };
}

export const formatPercent = (ratio: number) => `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
export const formatPosition = (position: number) => position.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
