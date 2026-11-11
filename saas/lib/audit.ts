import type { AuditCheck, Product, StoreState } from "./types";

// Deterministic catalogue checks. Scores come from these rules, never from
// the model, so the number shown to the client is always reproducible.

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function auditProduct(p: Product): { score: number; issues: AuditCheck[] } {
  const issues: AuditCheck[] = [];
  let score = 100;
  const penalize = (points: number, status: "warn" | "error", label: string, detail: string) => {
    score -= points;
    issues.push({ label, status, detail });
  };

  if (p.title.length < 25) {
    penalize(15, "error", "Titre trop court", `${p.title.length} caractères : ajoutez le type de produit, le format et un bénéfice.`);
  } else if (p.title.length > 70) {
    penalize(5, "warn", "Titre trop long", `${p.title.length} caractères : visez 30 à 65.`);
  }

  const words = wordCount(p.description);
  if (words < 30) {
    penalize(25, "error", "Description quasi vide", `${words} mots : trop peu pour convaincre et pour se positionner sur Google.`);
  } else if (words < 80) {
    penalize(10, "warn", "Description courte", `${words} mots : visez au moins 80.`);
  }

  if (!p.seoTitle.trim()) {
    penalize(20, "error", "Titre SEO manquant", "Google affichera un titre par défaut, rarement le meilleur.");
  } else if (p.seoTitle.length > 60) {
    penalize(5, "warn", "Titre SEO trop long", `${p.seoTitle.length} caractères : il sera coupé au-delà de 60.`);
  } else if (p.seoTitle.length < 30) {
    penalize(5, "warn", "Titre SEO trop court", `${p.seoTitle.length} caractères : il reste de la place pour un mot-clé.`);
  }

  if (!p.seoDescription.trim()) {
    penalize(20, "error", "Meta description manquante", "C'est le texte qui donne envie de cliquer dans les résultats.");
  } else if (p.seoDescription.length > 160 || p.seoDescription.length < 110) {
    penalize(5, "warn", "Meta description hors gabarit", `${p.seoDescription.length} caractères : visez 140 à 155.`);
  }

  if (!p.imageAlt.trim()) {
    penalize(10, "warn", "Image sans texte alternatif", "Indispensable pour Google Images et l'accessibilité.");
  }

  if (p.tags.length < 3) {
    penalize(5, "warn", "Peu de tags", `${p.tags.length} tag${p.tags.length > 1 ? "s" : ""} : ajoutez-en pour les filtres et les collections.`);
  }

  return { score: Math.max(0, score), issues };
}

export function auditCatalog(store: StoreState) {
  const rows = store.products.map((p) => {
    const { score, issues } = auditProduct(p);
    return { productId: p.id, title: p.title, score, issues };
  });
  const score = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length)
    : 0;
  return { score, rows };
}
