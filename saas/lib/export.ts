import { type Deliverable, describeDiscount, type EmailDeliverable, PRODUCT_FIELD_LABELS } from "./types";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatPrice = (price: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(price);

/** Only http(s) links may end up in an href. */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "#";
  } catch {
    return "#";
  }
}

/** A self-contained HTML email built from the structured content (every value escaped). */
export function emailHtml(email: EmailDeliverable, storeName: string): string {
  const paragraphs = email.paragraphs
    .map((p) => `<tr><td style="padding:0 32px 16px;font-size:16px;line-height:1.6;color:#374151">${escapeHtml(p)}</td></tr>`)
    .join("");
  const products = email.products.length
    ? `<tr><td style="padding:8px 24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${email.products
        .map(
          (p) =>
            `<td align="center" valign="top" width="${Math.floor(100 / email.products.length)}%" style="padding:8px"><div style="background:#f5f3ee;border-radius:10px;padding:22px 8px;font-size:34px">${escapeHtml(p.emoji)}</div><div style="padding-top:10px;font-size:14px;font-weight:bold;color:#111827">${escapeHtml(p.title)}</div><div style="padding-top:4px;font-size:14px;color:#6b7280">${escapeHtml(formatPrice(p.price))}</div></td>`,
        )
        .join("")}</tr></table></td></tr>`
    : "";
  const ps = email.ps
    ? `<tr><td style="padding:8px 32px 0;font-size:14px;line-height:1.6;color:#6b7280"><em>P.-S. ${escapeHtml(email.ps)}</em></td></tr>`
    : "";
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(email.subject)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(email.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="padding:20px 32px;border-bottom:1px solid #eeeeee;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#0f766e">${escapeHtml(storeName)}</td></tr>
<tr><td style="padding:28px 32px 16px;font-size:24px;line-height:1.3;font-weight:bold;color:#111827">${escapeHtml(email.headline)}</td></tr>
${paragraphs}
${products}
<tr><td align="center" style="padding:8px 32px 24px"><a href="${escapeHtml(safeUrl(email.ctaUrl))}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 28px;border-radius:8px">${escapeHtml(email.ctaLabel)}</a></td></tr>
${ps}
<tr><td style="padding:24px 32px 28px;font-size:12px;line-height:1.5;color:#9ca3af">Vous recevez cet email car vous êtes inscrit(e) aux actualités de ${escapeHtml(storeName)}. <u>Se désinscrire</u></td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** Plain-text version of a deliverable, for the « Copier » button. */
export function deliverableToText(d: Deliverable, storeName: string): string {
  switch (d.type) {
    case "product_update":
      return d.changes.map((c) => `${PRODUCT_FIELD_LABELS[c.field]} :\n${c.after}`).join("\n\n");
    case "price_update":
      return `${d.label}\n\n${d.changes.map((c) => `${c.productTitle} : ${formatPrice(c.before)} → ${formatPrice(c.after)}`).join("\n")}`;
    case "discount":
      return `${d.discount.code} — ${describeDiscount(d.discount)}`;
    case "announcement":
      return d.bar.messages.join("\n");
    case "page":
      return `# ${d.title}\n\nURL : /pages/${d.slug}\nTitre SEO : ${d.metaTitle}\nMeta description : ${d.metaDescription}\n\n${d.markdown}`;
    case "article":
      return `# ${d.title}\n\nURL : /blogs/${d.slug}\nMot-clé visé : ${d.keyword}\nTitre SEO : ${d.metaTitle}\nMeta description : ${d.metaDescription}\n\n${d.markdown}`;
    case "seo_audit":
      return d.scope === "catalog"
        ? `Audit SEO du catalogue — ${d.score}/100\n\n${d.rows
            .map((r) => `${r.title} — ${r.score}/100\n${r.issues.map((i) => `  - ${i.label} : ${i.detail}`).join("\n") || "  - Rien à signaler"}`)
            .join("\n\n")}`
        : `Audit SEO — ${d.target} — ${d.score}/100\n\n${d.checks.map((c) => `[${c.status === "ok" ? "OK" : c.status === "warn" ? "À améliorer" : "À corriger"}] ${c.label} : ${c.detail}`).join("\n")}`;
    case "email":
      return emailHtml(d, storeName);
    case "social_post":
      return `${d.caption}\n\n${d.hashtags.map((h) => `#${h}`).join(" ")}`;
    case "video_script":
      return `${d.title} — ${d.platform}, ${d.durationSeconds} s\n\n${d.presenter ? `Présentateur IA : ${d.presenter}\n\n` : ""}Accroche : ${d.hook}\n\n${d.scenes
        .map((s, i) => `Plan ${i + 1} (${s.seconds} s)\n  Image : ${s.visual}\n  Voix : ${s.voiceover || "—"}\n  Texte à l'écran : ${s.onScreenText || "—"}`)
        .join("\n\n")}\n\nAppel à l'action : ${d.cta}\n\nLégende : ${d.caption}\n${d.hashtags.map((h) => `#${h}`).join(" ")}`;
    case "calendar":
      return `${d.title}\n\n${d.entries.map((e) => `${e.day} — ${e.platform} — ${e.format} — ${e.topic} (${e.goal})`).join("\n")}`;
  }
}

export { formatPrice };
