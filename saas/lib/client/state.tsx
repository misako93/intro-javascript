"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createDemoStore } from "../demo-store";
import {
  AGENT_IDS,
  type AgentId,
  type ChatMessage,
  type ChatRequest,
  DELIVERABLE_TYPE_LABELS,
  type Deliverable,
  deliverableTitle,
  messageText,
  type StatusResponse,
  type StoreState,
  type StreamEvent,
} from "../types";

export interface AppState {
  store: StoreState;
  deliverables: Deliverable[];
  chats: Record<AgentId, ChatMessage[]>;
}

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "turn_start"; agentId: AgentId; userId: string; assistantId: string; text: string }
  | { type: "stream_event"; agentId: AgentId; id: string; event: StreamEvent }
  | { type: "turn_end"; agentId: AgentId; id: string; error?: string }
  | { type: "decide"; id: string; decision: "approved" | "rejected" }
  | { type: "clear_chat"; agentId: AgentId }
  | { type: "reset" };

export function initialState(): AppState {
  return {
    store: createDemoStore(),
    deliverables: [],
    chats: { webmaster: [], seo: [], email: [], social: [] },
  };
}

function updateMessage(state: AppState, agentId: AgentId, id: string, fn: (m: ChatMessage) => ChatMessage): AppState {
  return {
    ...state,
    chats: { ...state.chats, [agentId]: state.chats[agentId].map((m) => (m.id === id ? fn(m) : m)) },
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "reset":
      return initialState();
    case "clear_chat":
      return { ...state, chats: { ...state.chats, [action.agentId]: [] } };
    case "turn_start":
      return {
        ...state,
        chats: {
          ...state.chats,
          [action.agentId]: [
            ...state.chats[action.agentId],
            { id: action.userId, role: "user", parts: [{ kind: "text", text: action.text }] },
            { id: action.assistantId, role: "assistant", parts: [], streaming: true },
          ],
        },
      };
    case "turn_end":
      return updateMessage(state, action.agentId, action.id, (m) => ({
        ...m,
        streaming: false,
        error: action.error,
        parts: m.parts.map((p) =>
          p.kind === "tool" && p.status === "running" ? { ...p, status: "error", summary: "Interrompu" } : p,
        ),
      }));
    case "stream_event": {
      const event = action.event;
      if (event.type === "deliverable") {
        const withDeliverable = { ...state, deliverables: [...state.deliverables, event.deliverable] };
        return updateMessage(withDeliverable, action.agentId, action.id, (m) => ({
          ...m,
          parts: [...m.parts, { kind: "deliverable", id: event.deliverable.id }],
        }));
      }
      return updateMessage(state, action.agentId, action.id, (m) => {
        switch (event.type) {
          case "text": {
            const last = m.parts.at(-1);
            if (last?.kind === "text") {
              return { ...m, parts: [...m.parts.slice(0, -1), { kind: "text", text: last.text + event.delta }] };
            }
            return { ...m, parts: [...m.parts, { kind: "text", text: event.delta }] };
          }
          case "tool_start":
            return {
              ...m,
              parts: [...m.parts, { kind: "tool", id: event.id, name: event.name, label: event.label, status: "running", chars: 0, summary: "" }],
            };
          case "tool_progress":
            return { ...m, parts: m.parts.map((p) => (p.kind === "tool" && p.id === event.id ? { ...p, chars: event.chars } : p)) };
          case "tool_end":
            return {
              ...m,
              parts: m.parts.map((p) =>
                p.kind === "tool" && p.id === event.id ? { ...p, status: event.ok ? "ok" : "error", summary: event.summary } : p,
              ),
            };
          default:
            return m;
        }
      });
    }
    case "decide": {
      const target = state.deliverables.find((d) => d.id === action.id);
      if (!target || target.type !== "product_update" || target.status !== "pending") return state;
      const deliverables = state.deliverables.map((d) =>
        d.id === action.id && d.type === "product_update" ? { ...d, status: action.decision } : d,
      );
      if (action.decision === "rejected") return { ...state, deliverables };
      // Approved: apply the proposed values to the product.
      const products = state.store.products.map((p) => {
        if (p.id !== target.productId) return p;
        const next = { ...p, updatedByAi: true };
        for (const change of target.changes) {
          if (change.field === "tags") next.tags = change.after.split(",").map((t) => t.trim()).filter(Boolean);
          else next[change.field] = change.after;
        }
        return next;
      });
      return { ...state, deliverables, store: { ...state.store, products } };
    }
  }
}

const STORAGE_KEY = "wakil:state:v1";
const CODE_KEY = "wakil:access-code";

function loadState(): AppState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as AppState;
    if (!saved?.store?.products || !Array.isArray(saved.deliverables) || !saved.chats) return null;
    // A reload interrupts any turn that was streaming.
    for (const agentId of AGENT_IDS) {
      saved.chats[agentId] = (saved.chats[agentId] ?? []).map((m) => ({
        ...m,
        streaming: false,
        parts: m.parts.map((p) => (p.kind === "tool" && p.status === "running" ? { ...p, status: "error" as const, summary: "Interrompu" } : p)),
      }));
    }
    return saved;
  } catch {
    return null;
  }
}

export type ServerStatus = StatusResponse & { codeValid: boolean };

interface AppContextValue {
  state: AppState;
  ready: boolean;
  status: ServerStatus | null;
  busy: Record<AgentId, boolean>;
  send: (agentId: AgentId, text: string) => void;
  stop: (agentId: AgentId) => void;
  decide: (id: string, decision: "approved" | "rejected") => void;
  clearChat: (agentId: AgentId) => void;
  reset: () => void;
  submitAccessCode: (code: string) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}

const newId = () => Math.random().toString(36).slice(2, 10);

async function fetchStatus(code: string): Promise<ServerStatus | null> {
  try {
    const response = await fetch("/api/status", { headers: { "x-access-code": code }, cache: "no-store" });
    return response.ok ? ((await response.json()) as ServerStatus) : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [busy, setBusy] = useState<Record<AgentId, boolean>>({ webmaster: false, seo: false, email: false, social: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const codeRef = useRef("");
  const aborters = useRef<Partial<Record<AgentId, AbortController>>>({});

  // Load the saved workspace and the server status once, on the client.
  useEffect(() => {
    const saved = loadState();
    if (saved) dispatch({ type: "hydrate", state: saved });
    codeRef.current = window.localStorage.getItem(CODE_KEY) ?? "";
    setReady(true);
    void fetchStatus(codeRef.current).then(setStatus);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage full or unavailable: the session still works in memory.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state, ready]);

  const send = useCallback((agentId: AgentId, rawText: string) => {
    const text = rawText.trim();
    if (!text || aborters.current[agentId]) return;
    const current = stateRef.current;
    const userId = newId();
    const assistantId = newId();

    const request: ChatRequest = {
      agentId,
      message: text,
      history: current.chats[agentId]
        .map((m) => ({ role: m.role, text: messageText(m) }))
        .filter((turn) => turn.text)
        .slice(-20),
      store: current.store,
      workspace: {
        pendingCount: current.deliverables.filter((d) => d.type === "product_update" && d.status === "pending").length,
        deliverables: current.deliverables
          .filter((d) => d.agentId === agentId)
          .slice(-20)
          .map((d) => ({
            type: DELIVERABLE_TYPE_LABELS[d.type],
            title: deliverableTitle(d),
            status:
              d.type === "product_update"
                ? { pending: "en attente de validation", approved: "validée et appliquée", rejected: "refusée par le client" }[d.status]
                : undefined,
          })),
      },
    };

    dispatch({ type: "turn_start", agentId, userId, assistantId, text });
    const aborter = new AbortController();
    aborters.current[agentId] = aborter;
    setBusy((b) => ({ ...b, [agentId]: true }));

    void (async () => {
      let error: string | undefined;
      let finished = false;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", "x-access-code": codeRef.current },
          body: JSON.stringify(request),
          signal: aborter.signal,
        });
        if (response.status === 401) {
          setStatus((s) => (s ? { ...s, requiresCode: true, codeValid: false } : s));
          throw new Error("Code d'accès requis.");
        }
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Le serveur a répondu avec une erreur ${response.status}.`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "done") finished = true;
            else if (event.type === "error") {
              finished = true;
              error = event.message;
            } else dispatch({ type: "stream_event", agentId, id: assistantId, event });
          }
        }
        if (!finished) error = "La connexion a été interrompue avant la fin de la réponse.";
      } catch (caught) {
        if (aborter.signal.aborted) error = undefined;
        else error = caught instanceof Error && caught.message ? caught.message : "Connexion au serveur impossible.";
      } finally {
        delete aborters.current[agentId];
        setBusy((b) => ({ ...b, [agentId]: false }));
        dispatch({ type: "turn_end", agentId, id: assistantId, error });
      }
    })();
  }, []);

  const stop = useCallback((agentId: AgentId) => aborters.current[agentId]?.abort(), []);
  const decide = useCallback((id: string, decision: "approved" | "rejected") => dispatch({ type: "decide", id, decision }), []);
  const clearChat = useCallback((agentId: AgentId) => {
    aborters.current[agentId]?.abort();
    dispatch({ type: "clear_chat", agentId });
  }, []);
  const reset = useCallback(() => {
    for (const agentId of AGENT_IDS) aborters.current[agentId]?.abort();
    dispatch({ type: "reset" });
  }, []);

  const submitAccessCode = useCallback(async (code: string) => {
    const next = await fetchStatus(code.trim());
    if (!next?.codeValid) return false;
    codeRef.current = code.trim();
    window.localStorage.setItem(CODE_KEY, codeRef.current);
    setStatus(next);
    return true;
  }, []);

  const value = useMemo(
    () => ({ state, ready, status, busy, send, stop, decide, clearChat, reset, submitAccessCode }),
    [state, ready, status, busy, send, stop, decide, clearChat, reset, submitAccessCode],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
