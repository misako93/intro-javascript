"use client";

import { strFromU8, unzipSync } from "fflate";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "@/lib/client/state";
import { createDemoStore } from "@/lib/demo-store";
import { analyzeSearch, buildSearchPerformance, formatPercent, formatPosition, SearchImportError } from "@/lib/search";
import { QueryTable, SearchTotals } from "./Deliverables";

/** Reads the CSV files of an export: a ZIP as Search Console produces it, or loose CSV files. */
async function readExport(files: File[]): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const file of files) {
    if (file.size > 20_000_000) throw new SearchImportError("Ce fichier est trop volumineux pour être un export Search Console.");
    if (file.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      for (const [name, bytes] of Object.entries(entries)) {
        if (name.toLowerCase().endsWith(".csv")) out.push({ name, text: strFromU8(bytes) });
      }
    } else {
      out.push({ name: file.name, text: await file.text() });
    }
  }
  return out;
}

export function SearchConsoleView() {
  const { state, setSearch } = useApp();
  const search = state.store.search;
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    try {
      const csv = await readExport([...files]);
      const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());
      setSearch(buildSearchPerformance(csv, today));
    } catch (caught) {
      setError(caught instanceof SearchImportError ? caught.message : "Ce fichier n'a pas pu être lu. Déposez le fichier ZIP exporté depuis Search Console.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const insights = search ? analyzeSearch(search, state.store.name) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Search Console</h1>
          <p className="muted">
            Les données de recherche Google sur lesquelles l&apos;Agent SEO s&apos;appuie pour ses rapports et ses priorités.
          </p>
        </div>
      </header>

      <div className="import-box">
        <div>
          <strong>
            {search === null
              ? "Aucune donnée pour l'instant"
              : search.source === "demo"
                ? "Données de démonstration"
                : "Vos données Search Console"}
          </strong>
          <p className="muted">
            {search === null
              ? "Importez votre export pour que l'Agent SEO travaille sur vos vrais chiffres."
              : search.source === "demo"
                ? "Ces chiffres sont des exemples. Importez votre export pour travailler sur les vôtres."
                : search.period}
          </p>
          <p className="import-help">
            Dans Search Console : <em>Performances</em>, bouton <em>Exporter</em>, puis <em>Télécharger au format CSV</em>. Déposez ici le fichier ZIP obtenu. La connexion directe à votre compte Google n&apos;est pas encore disponible.
          </p>
          {error && <div className="msg-error">{error}</div>}
        </div>
        <div className="import-actions">
          <input ref={input} id="search-export" type="file" accept=".zip,.csv" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
            <Upload size={16} /> Importer un export
          </button>
          {search?.source === "import" && (
            <button type="button" className="btn btn-ghost" onClick={() => setSearch(createDemoStore().search)}>
              Revenir aux données de démonstration
            </button>
          )}
        </div>
      </div>

      {search && insights && (
        <>
          <SearchTotals totals={insights.totals} />

          <h2 className="section-title">Requêtes qui amènent le plus de clics</h2>
          <QueryTable rows={insights.topQueries} />

          {insights.quickWins.length > 0 && (
            <>
              <h2 className="section-title">À portée de la première page (positions 4 à 15)</h2>
              <QueryTable rows={insights.quickWins} />
            </>
          )}

          {insights.topPages.length > 0 && (
            <>
              <h2 className="section-title">Pages qui amènent le plus de clics</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Page</th><th>Clics</th><th>Impressions</th><th>Taux de clic</th><th>Position</th></tr></thead>
                  <tbody>
                    {insights.topPages.map((p) => (
                      <tr key={p.url}>
                        <td>{p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
                        <td className="nowrap">{p.clicks.toLocaleString("fr-FR")}</td>
                        <td className="nowrap">{p.impressions.toLocaleString("fr-FR")}</td>
                        <td className="nowrap">{formatPercent(p.ctr)}</td>
                        <td className="nowrap">{formatPosition(p.position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
