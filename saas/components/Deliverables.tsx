"use client";

import { CalendarDays, Check, ClipboardCheck, FileText, Gauge, Mail, Newspaper, PenLine, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENTS, agentById } from "@/lib/agents";
import { useApp } from "@/lib/client/state";
import { deliverableToText, emailHtml, formatPrice } from "@/lib/export";
import {
  type AgentId,
  DELIVERABLE_TYPE_LABELS,
  type Deliverable,
  deliverableTitle,
  PRODUCT_FIELD_LABELS,
  type ProductUpdateDeliverable,
} from "@/lib/types";
import { CopyButton, Markdown, ScorePill, ScoreRing, StatusIcon } from "./ui";

const TYPE_ICONS = {
  product_update: PenLine,
  page: FileText,
  article: Newspaper,
  seo_audit: Gauge,
  email: Mail,
  social_post: ClipboardCheck,
  video_script: Video,
  calendar: CalendarDays,
} as const;

const STATUS_LABELS = { pending: "À valider", approved: "Appliquée", rejected: "Refusée" } as const;

function metaLine(d: Deliverable): string {
  switch (d.type) {
    case "product_update":
      return d.changes.map((c) => PRODUCT_FIELD_LABELS[c.field]).join(" · ");
    case "page":
      return `/pages/${d.slug}`;
    case "article":
      return `Mot-clé : ${d.keyword}`;
    case "seo_audit":
      return d.scope === "catalog" ? `${d.rows.length} fiches analysées` : `${d.checks.length} points vérifiés`;
    case "email":
      return [d.sequence, d.sendTiming].filter(Boolean).join(" · ") || `Objet : ${d.subject}`;
    case "social_post":
      return d.caption.split("\n")[0];
    case "video_script":
      return `${d.platform} · ${d.durationSeconds} s · ${d.scenes.length} plans`;
    case "calendar":
      return `${d.entries.length} publications`;
  }
}

function DecisionButtons({ d }: { d: ProductUpdateDeliverable }) {
  const { decide } = useApp();
  if (d.status !== "pending") return null;
  return (
    <div className="decision">
      <button type="button" className="btn btn-approve" onClick={(e) => { e.stopPropagation(); decide(d.id, "approved"); }}>
        <Check size={15} /> Valider
      </button>
      <button type="button" className="btn btn-reject" onClick={(e) => { e.stopPropagation(); decide(d.id, "rejected"); }}>
        <X size={15} /> Refuser
      </button>
    </div>
  );
}

export function DeliverableCard({ d, onOpen, showAgent = false }: { d: Deliverable; onOpen: (id: string) => void; showAgent?: boolean }) {
  const Icon = TYPE_ICONS[d.type];
  const agent = agentById(d.agentId);
  return (
    <div
      className="deliverable-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(d.id);
        }
      }}
    >
      <span className="deliverable-icon" style={{ color: agent.color, background: `${agent.color}14` }}>
        <Icon size={18} />
      </span>
      <div className="deliverable-body">
        <div className="deliverable-kicker">
          {DELIVERABLE_TYPE_LABELS[d.type]}
          {showAgent && <span> · {agent.name}</span>}
          {d.type === "product_update" && <span className={`status-pill status-${d.status}`}>{STATUS_LABELS[d.status]}</span>}
          {d.type === "seo_audit" && <ScorePill score={d.score} />}
        </div>
        <div className="deliverable-title">{deliverableTitle(d)}</div>
        <div className="deliverable-meta">{metaLine(d)}</div>
        {d.type === "product_update" && <DecisionButtons d={d} />}
      </div>
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  return <span className={`char-count ${value.length > max ? "tone-text-error" : ""}`}>{value.length} car.</span>;
}

function SeoMeta({ url, title, description, keyword }: { url: string; title: string; description: string; keyword?: string }) {
  return (
    <div className="serp">
      <div className="serp-label">Aperçu dans Google</div>
      <div className="serp-url">{url}</div>
      <div className="serp-title">{title}</div>
      <div className="serp-description">{description}</div>
      <div className="serp-counts">
        Titre <CharCount value={title} max={60} /> · Description <CharCount value={description} max={160} />
        {keyword && <> · Mot-clé visé : <strong>{keyword}</strong></>}
      </div>
    </div>
  );
}

function DetailBody({ d }: { d: Deliverable }) {
  const { state } = useApp();
  const store = state.store;
  switch (d.type) {
    case "product_update":
      return (
        <>
          <p className="reason"><strong>Pourquoi ce changement :</strong> {d.reason}</p>
          {d.changes.map((c) => (
            <div className="diff" key={c.field}>
              <div className="diff-label">
                {PRODUCT_FIELD_LABELS[c.field]}
                {(c.field === "seoTitle" || c.field === "seoDescription") && <CharCount value={c.after} max={c.field === "seoTitle" ? 60 : 160} />}
              </div>
              <div className="diff-columns">
                <div className="diff-before">
                  <span>Avant</span>
                  {c.before || <em>Vide</em>}
                </div>
                <div className="diff-after">
                  <span>Après</span>
                  {c.after}
                </div>
              </div>
            </div>
          ))}
        </>
      );
    case "page":
      return (
        <>
          <SeoMeta url={`${store.url}/pages/${d.slug}`} title={d.metaTitle} description={d.metaDescription} />
          <article className="document">
            <h1>{d.title}</h1>
            <Markdown>{d.markdown}</Markdown>
          </article>
        </>
      );
    case "article":
      return (
        <>
          <SeoMeta url={`${store.url}/blogs/${d.slug}`} title={d.metaTitle} description={d.metaDescription} keyword={d.keyword} />
          <article className="document">
            <h1>{d.title}</h1>
            <Markdown>{d.markdown}</Markdown>
          </article>
        </>
      );
    case "seo_audit":
      return (
        <>
          <div className="audit-head">
            <ScoreRing score={d.score} />
            <div>
              <div className="audit-target">{d.scope === "catalog" ? `Catalogue ${d.target}` : d.target}</div>
              <div className="muted">
                {d.scope === "catalog"
                  ? `Score moyen de ${d.rows.length} fiches, calculé sur des règles fixes : longueur des titres et descriptions, balises SEO, textes alternatifs, tags.`
                  : `${d.checks.filter((c) => c.status !== "ok").length} point(s) à traiter sur ${d.checks.length} vérifiés.`}
              </div>
            </div>
          </div>
          {d.scope === "catalog" ? (
            <div className="audit-rows">
              {[...d.rows].sort((a, b) => a.score - b.score).map((row) => (
                <div className="audit-row" key={row.productId}>
                  <div className="audit-row-head">
                    <strong>{row.title}</strong>
                    <ScorePill score={row.score} />
                  </div>
                  {row.issues.length === 0 ? (
                    <div className="check"><StatusIcon status="ok" /> <span>Fiche complète, rien à signaler.</span></div>
                  ) : (
                    row.issues.map((issue) => (
                      <div className="check" key={issue.label}>
                        <StatusIcon status={issue.status} />
                        <span><strong>{issue.label}</strong> — {issue.detail}</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="audit-rows">
              <div className="audit-row">
                {d.checks.map((check) => (
                  <div className="check" key={check.label}>
                    <StatusIcon status={check.status} />
                    <span><strong>{check.label}</strong> — {check.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      );
    case "email":
      return (
        <>
          <div className="inbox-line">
            <span className="inbox-sender">{store.name}</span>
            <span className="inbox-subject">{d.subject}</span>
            <span className="inbox-preheader"> — {d.preheader}</span>
          </div>
          <div className="serp-counts">
            Objet <CharCount value={d.subject} max={45} />
            {d.sequence && <> · {d.sequence}</>}
            {d.sendTiming && <> · Envoi : {d.sendTiming}</>}
          </div>
          <iframe className="email-frame" title="Aperçu de l'email" sandbox="" srcDoc={emailHtml(d, store.name)} />
        </>
      );
    case "social_post":
      return (
        <>
          <div className="pills"><span className="pill">{d.platform}</span><span className="pill">{d.format}</span></div>
          <div className="post-card">
            <div className="post-head"><span className="post-avatar">{store.name.slice(0, 1)}</span><strong>{store.name}</strong></div>
            <div className="post-visual"><span>Visuel à produire</span>{d.visualIdea}</div>
            <p className="post-caption">{d.caption}</p>
            <p className="post-tags">{d.hashtags.map((h) => `#${h}`).join(" ")}</p>
          </div>
        </>
      );
    case "video_script":
      return (
        <>
          <div className="pills"><span className="pill">{d.platform}</span><span className="pill">{d.durationSeconds} secondes</span><span className="pill">{d.scenes.length} plans</span></div>
          <div className="hook"><span>Accroche — 2 premières secondes</span>{d.hook}</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plan</th><th>Ce qu&apos;on filme</th><th>Voix off</th><th>Texte à l&apos;écran</th></tr></thead>
              <tbody>
                {d.scenes.map((s, i) => (
                  <tr key={i}>
                    <td className="nowrap"><strong>{i + 1}</strong> · {s.seconds} s</td>
                    <td>{s.visual}</td>
                    <td>{s.voiceover || "—"}</td>
                    <td>{s.onScreenText || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="script-foot">
            <div><span>Appel à l&apos;action</span>{d.cta}</div>
            <div><span>Légende</span>{d.caption}</div>
            <div><span>Hashtags</span>{d.hashtags.map((h) => `#${h}`).join(" ")}</div>
          </div>
        </>
      );
    case "calendar":
      return (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Jour</th><th>Réseau</th><th>Format</th><th>Sujet</th><th>Objectif</th></tr></thead>
            <tbody>
              {d.entries.map((e, i) => (
                <tr key={i}>
                  <td className="nowrap"><strong>{e.day}</strong></td>
                  <td>{e.platform}</td>
                  <td>{e.format}</td>
                  <td>{e.topic}</td>
                  <td>{e.goal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function DeliverableModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useApp();
  const d = state.deliverables.find((x) => x.id === id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!d) return null;
  const agent = agentById(d.agentId);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={deliverableTitle(d)} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="deliverable-kicker" style={{ color: agent.color }}>
              {DELIVERABLE_TYPE_LABELS[d.type]} · {agent.name}
              {d.type === "product_update" && <span className={`status-pill status-${d.status}`}>{STATUS_LABELS[d.status]}</span>}
            </div>
            <h2>{deliverableTitle(d)}</h2>
          </div>
          <div className="modal-actions">
            <CopyButton text={deliverableToText(d, state.store.name)} label={d.type === "email" ? "Copier le HTML" : "Copier"} />
            <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
          </div>
        </header>
        <div className="modal-body">
          <DetailBody d={d} />
        </div>
        {d.type === "product_update" && d.status === "pending" && (
          <footer className="modal-foot">
            <span className="muted">Rien n&apos;est modifié dans la boutique tant que vous n&apos;avez pas validé.</span>
            <DecisionButtons d={d} />
          </footer>
        )}
      </div>
    </div>
  );
}

export function DeliverablesView({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useApp();
  const [filter, setFilter] = useState<AgentId | "all" | "pending">("all");
  const sorted = [...state.deliverables].sort((a, b) => b.createdAt - a.createdAt);
  const pending = sorted.filter((d) => d.type === "product_update" && d.status === "pending");
  const shown = filter === "all" ? sorted : filter === "pending" ? pending : sorted.filter((d) => d.agentId === filter);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Livrables</h1>
          <p className="muted">Tout ce que vos agents ont produit, prêt à être relu, copié ou validé.</p>
        </div>
      </header>
      <div className="filters">
        <button type="button" className={`chip ${filter === "all" ? "chip-active" : ""}`} onClick={() => setFilter("all")}>Tous ({sorted.length})</button>
        <button type="button" className={`chip ${filter === "pending" ? "chip-active" : ""}`} onClick={() => setFilter("pending")}>À valider ({pending.length})</button>
        {AGENTS.map((a) => (
          <button type="button" key={a.id} className={`chip ${filter === a.id ? "chip-active" : ""}`} onClick={() => setFilter(a.id)}>
            {a.name.replace("Agent ", "")} ({sorted.filter((d) => d.agentId === a.id).length})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">Aucun livrable ici pour l&apos;instant. Ouvrez un agent et confiez-lui une première tâche.</div>
      ) : (
        <div className="deliverable-grid">
          {shown.map((d) => <DeliverableCard key={d.id} d={d} onOpen={onOpen} showAgent />)}
        </div>
      )}
    </div>
  );
}

export { formatPrice };
