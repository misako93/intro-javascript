"use client";

import { BookOpenText, ChartLine, Eye, FolderOpen, LayoutDashboard, LoaderCircle, Lock, RotateCcw, Store } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { AppProvider, useApp } from "@/lib/client/state";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { AGENT_IDS, type AgentId, pendingChanges } from "@/lib/types";
import { AgentView } from "./AgentView";
import { BrandView } from "./BrandView";
import { Dashboard } from "./Dashboard";
import { DeliverableModal, DeliverablesView } from "./Deliverables";
import { SearchConsoleView } from "./SearchConsoleView";
import { Storefront } from "./Storefront";
import { StoreView } from "./StoreView";
import { AgentIcon } from "./ui";

type View = "dashboard" | "brand" | "store" | "storefront" | "search" | "deliverables" | `agent:${AgentId}`;

function parseView(hash: string): View {
  const value = hash.replace(/^#\/?/, "");
  if (value === "brand" || value === "store" || value === "storefront" || value === "search" || value === "deliverables") return value;
  const agent = AGENT_IDS.find((id) => value === `agent:${id}`);
  return agent ? `agent:${agent}` : "dashboard";
}

function AccessGate() {
  const { submitAccessCode } = useApp();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    const ok = await submitAccessCode(code);
    setChecking(false);
    setError(!ok);
  };
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={onSubmit}>
        <span className="brand-mark brand-mark-lg">{APP_NAME.slice(0, 1)}</span>
        <h1>{APP_NAME}</h1>
        <p className="muted">Cet espace est protégé. Saisissez votre code d&apos;accès pour continuer.</p>
        <label htmlFor="access-code">Code d&apos;accès</label>
        <input id="access-code" type="password" autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        {error && <div className="msg-error">Code incorrect.</div>}
        <button type="submit" className="btn btn-primary" disabled={!code.trim() || checking}>
          <Lock size={16} /> {checking ? "Vérification…" : "Entrer"}
        </button>
      </form>
    </div>
  );
}

function Shell() {
  const { state, status, busy, reset } = useApp();
  const [view, setView] = useState<View>("dashboard");
  const [openDeliverable, setOpenDeliverable] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setView(parseView(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = `/${next}`;
    setView(next);
  }, []);
  const closeModal = useCallback(() => setOpenDeliverable(null), []);

  if (status?.requiresCode && !status.codeValid) return <AccessGate />;

  const pendingCount = pendingChanges(state.deliverables).length;
  const activeAgent = view.startsWith("agent:") ? (view.slice(6) as AgentId) : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">{APP_NAME.slice(0, 1)}</span>
          <div>
            <div className="brand-name">{APP_NAME}</div>
            <div className="brand-tagline">{APP_TAGLINE}</div>
          </div>
        </div>

        <nav className="nav">
          <button type="button" className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => navigate("dashboard")}>
            <LayoutDashboard size={18} /> <span>Tableau de bord</span>
          </button>

          <div className="nav-label">Vos agents</div>
          {AGENTS.map((agent) => (
            <button
              type="button"
              key={agent.id}
              className={`nav-item ${activeAgent === agent.id ? "active" : ""}`}
              onClick={() => navigate(`agent:${agent.id}`)}
            >
              <AgentIcon id={agent.id} size={22} />
              <span>{agent.name.replace("Agent ", "")}</span>
              {busy[agent.id] && <LoaderCircle size={14} className="spin nav-trailing" aria-label="En cours" />}
            </button>
          ))}

          <div className="nav-label">Votre boutique</div>
          <button type="button" className={`nav-item ${view === "brand" ? "active" : ""}`} onClick={() => navigate("brand")}>
            <BookOpenText size={18} /> <span>Brief de marque</span>
          </button>
          <button type="button" className={`nav-item ${view === "store" ? "active" : ""}`} onClick={() => navigate("store")}>
            <Store size={18} /> <span>Catalogue</span>
          </button>
          <button type="button" className={`nav-item ${view === "storefront" ? "active" : ""}`} onClick={() => navigate("storefront")}>
            <Eye size={18} /> <span>Aperçu du site</span>
          </button>
          <button type="button" className={`nav-item ${view === "search" ? "active" : ""}`} onClick={() => navigate("search")}>
            <ChartLine size={18} /> <span>Search Console</span>
          </button>
          <button type="button" className={`nav-item ${view === "deliverables" ? "active" : ""}`} onClick={() => navigate("deliverables")}>
            <FolderOpen size={18} /> <span>Livrables</span>
            {pendingCount > 0 && <span className="badge nav-trailing">{pendingCount}</span>}
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="store-chip">
            <span className="store-dot" />
            <div>
              <strong>{state.store.name}</strong>
              <span>Boutique de démonstration</span>
            </div>
          </div>
          <button
            type="button"
            className="reset"
            onClick={() => {
              if (window.confirm("Remettre la démo à zéro ? Les conversations, les livrables et les modifications du catalogue seront effacés.")) {
                reset();
                navigate("dashboard");
              }
            }}
          >
            <RotateCcw size={14} /> Réinitialiser la démo
          </button>
        </div>
      </aside>

      <main className="main">
        {status?.demo && (
          <div className="demo-banner">
            <strong>Mode démo</strong> — aucune clé API n&apos;est configurée : les réponses des agents sont des exemples préenregistrés.
          </div>
        )}
        {activeAgent ? (
          <AgentView key={activeAgent} agentId={activeAgent} onOpen={setOpenDeliverable} />
        ) : view === "store" ? (
          <StoreView />
        ) : view === "storefront" ? (
          <Storefront />
        ) : view === "brand" ? (
          <BrandView />
        ) : view === "search" ? (
          <SearchConsoleView />
        ) : view === "deliverables" ? (
          <DeliverablesView onOpen={setOpenDeliverable} />
        ) : (
          <Dashboard onOpenAgent={(id) => navigate(`agent:${id}`)} onOpenDeliverable={setOpenDeliverable} onNavigate={navigate} />
        )}
      </main>

      {openDeliverable && <DeliverableModal id={openDeliverable} onClose={closeModal} />}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
