"use client";

import { ArrowRight } from "lucide-react";
import { AGENTS } from "@/lib/agents";
import { auditCatalog } from "@/lib/audit";
import { useApp } from "@/lib/client/state";
import type { AgentId } from "@/lib/types";
import { DeliverableCard } from "./Deliverables";
import { AgentIcon, ScoreRing } from "./ui";

export function Dashboard({ onOpenAgent, onOpenDeliverable, onNavigate }: {
  onOpenAgent: (id: AgentId) => void;
  onOpenDeliverable: (id: string) => void;
  onNavigate: (view: "store" | "deliverables") => void;
}) {
  const { state } = useApp();
  const { score } = auditCatalog(state.store);
  const pending = state.deliverables.filter((d) => d.type === "product_update" && d.status === "pending");
  const improved = state.store.products.filter((p) => p.updatedByAi).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Votre équipe IA est prête</h1>
          <p className="muted">
            Quatre agents spécialisés travaillent sur {state.store.name}. Ils préparent, vous validez : rien n&apos;est publié sans votre accord.
          </p>
        </div>
      </header>

      <div className="stats">
        <button type="button" className="stat stat-score" onClick={() => onNavigate("store")}>
          <ScoreRing score={score} size={64} />
          <div>
            <div className="stat-label">Score SEO du catalogue</div>
            <div className="stat-hint">Moyenne des {state.store.products.length} fiches</div>
          </div>
        </button>
        <button type="button" className="stat" onClick={() => onNavigate("deliverables")}>
          <div className="stat-value">{pending.length}</div>
          <div className="stat-label">À valider</div>
          <div className="stat-hint">Modifications proposées</div>
        </button>
        <button type="button" className="stat" onClick={() => onNavigate("deliverables")}>
          <div className="stat-value">{state.deliverables.length}</div>
          <div className="stat-label">Livrables créés</div>
          <div className="stat-hint">Fiches, emails, scripts, audits</div>
        </button>
        <button type="button" className="stat" onClick={() => onNavigate("store")}>
          <div className="stat-value">
            {improved}
            <small>/{state.store.products.length}</small>
          </div>
          <div className="stat-label">Fiches améliorées</div>
          <div className="stat-hint">Validées et appliquées</div>
        </button>
      </div>

      <h2 className="section-title">Vos agents</h2>
      <div className="agent-grid">
        {AGENTS.map((agent) => {
          const count = state.deliverables.filter((d) => d.agentId === agent.id).length;
          return (
            <button type="button" className="agent-card" key={agent.id} onClick={() => onOpenAgent(agent.id)}>
              <div className="agent-card-head">
                <AgentIcon id={agent.id} size={44} />
                <div>
                  <h3>{agent.name}</h3>
                  <span style={{ color: agent.color }}>{agent.role}</span>
                </div>
              </div>
              <p>{agent.description}</p>
              <div className="agent-card-foot">
                <span className="muted">{count === 0 ? "Aucun livrable pour l'instant" : `${count} livrable${count > 1 ? "s" : ""}`}</span>
                <span className="agent-card-cta" style={{ color: agent.color }}>
                  Ouvrir <ArrowRight size={15} />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {pending.length > 0 && (
        <>
          <h2 className="section-title">En attente de votre validation</h2>
          <div className="deliverable-grid">
            {pending.map((d) => <DeliverableCard key={d.id} d={d} onOpen={onOpenDeliverable} showAgent />)}
          </div>
        </>
      )}
    </div>
  );
}
