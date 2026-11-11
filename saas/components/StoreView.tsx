"use client";

import { Sparkles } from "lucide-react";
import { auditCatalog, auditProduct } from "@/lib/audit";
import { useApp } from "@/lib/client/state";
import { formatPrice } from "@/lib/export";
import { ScorePill, ScoreRing, StatusIcon } from "./ui";

export function StoreView() {
  const { state } = useApp();
  const { store } = state;
  const { score } = auditCatalog(store);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Catalogue — {store.name}</h1>
          <p className="muted">
            L&apos;état réel de vos fiches. Chaque modification validée s&apos;applique ici, et le score se met à jour.
          </p>
        </div>
        <div className="head-score">
          <ScoreRing score={score} size={64} />
          <span>Score SEO<br />du catalogue</span>
        </div>
      </header>

      <div className="product-list">
        {store.products.map((p) => {
          const audit = auditProduct(p);
          return (
            <details className="product" key={p.id}>
              <summary>
                <span className="product-thumb">{p.emoji}</span>
                <div className="product-main">
                  <div className="product-title">
                    {p.title}
                    {p.updatedByAi && (
                      <span className="ai-badge"><Sparkles size={12} /> Mise à jour par l&apos;IA</span>
                    )}
                  </div>
                  <div className="product-sub">
                    {p.category} · {formatPrice(p.price)}
                    {p.compareAtPrice && p.compareAtPrice > p.price ? <s> {formatPrice(p.compareAtPrice)}</s> : null}
                  </div>
                  <div className="product-excerpt">{p.description}</div>
                </div>
                <div className="product-side">
                  <ScorePill score={audit.score} />
                  <span className="muted">{audit.issues.length === 0 ? "Fiche complète" : `${audit.issues.length} point${audit.issues.length > 1 ? "s" : ""} à traiter`}</span>
                </div>
              </summary>
              <div className="product-detail">
                <div>
                  <h4>Description</h4>
                  <p className="pre">{p.description}</p>
                  <h4>Tags</h4>
                  <div className="pills">{p.tags.map((t) => <span className="pill" key={t}>{t}</span>)}</div>
                </div>
                <div>
                  <h4>Référencement</h4>
                  <dl className="seo-fields">
                    <dt>Titre SEO</dt>
                    <dd>{p.seoTitle || <span className="missing">Manquant</span>}</dd>
                    <dt>Meta description</dt>
                    <dd>{p.seoDescription || <span className="missing">Manquante</span>}</dd>
                    <dt>Texte alternatif de l&apos;image</dt>
                    <dd>{p.imageAlt || <span className="missing">Manquant</span>}</dd>
                  </dl>
                  {audit.issues.length > 0 && (
                    <>
                      <h4>Points à traiter</h4>
                      {audit.issues.map((issue) => (
                        <div className="check" key={issue.label}>
                          <StatusIcon status={issue.status} />
                          <span><strong>{issue.label}</strong> — {issue.detail}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
