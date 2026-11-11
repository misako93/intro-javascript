"use client";

import { ArrowRight, Check, LoaderCircle, MessageSquarePlus, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { agentById } from "@/lib/agents";
import { useApp } from "@/lib/client/state";
import type { AgentId, ChatMessage, MessagePart } from "@/lib/types";
import { DeliverableCard } from "./Deliverables";
import { AgentIcon, Markdown } from "./ui";

function ToolChip({ part }: { part: Extract<MessagePart, { kind: "tool" }> }) {
  if (part.status === "running") {
    return (
      <div className="tool-chip tool-running">
        <LoaderCircle size={15} className="spin" />
        <span>
          {part.label}
          {part.chars > 0 ? ` · ${part.chars.toLocaleString("fr-FR")} caractères` : "…"}
        </span>
      </div>
    );
  }
  return (
    <div className={`tool-chip ${part.status === "ok" ? "tool-ok" : "tool-error"}`}>
      {part.status === "ok" ? <Check size={15} /> : <X size={15} />}
      <span>{part.summary || part.label}</span>
    </div>
  );
}

function AssistantMessage({ message, agentId, onOpen }: { message: ChatMessage; agentId: AgentId; onOpen: (id: string) => void }) {
  const { state } = useApp();
  const last = message.parts.at(-1);
  const waiting = message.streaming && (!last || last.kind === "deliverable" || (last.kind === "tool" && last.status !== "running"));
  return (
    <div className="msg msg-assistant">
      <AgentIcon id={agentId} size={32} />
      <div className="msg-content">
        {message.parts.map((part, index) => {
          if (part.kind === "text") {
            const text = part.text.trim();
            return text ? <Markdown key={index}>{text}</Markdown> : null;
          }
          if (part.kind === "tool") return <ToolChip key={part.id} part={part} />;
          const deliverable = state.deliverables.find((d) => d.id === part.id);
          return deliverable ? <DeliverableCard key={part.id} d={deliverable} onOpen={onOpen} /> : null;
        })}
        {waiting && (
          <div className="typing" aria-label="L'agent réfléchit">
            <span /><span /><span />
          </div>
        )}
        {message.error && <div className="msg-error">{message.error}</div>}
      </div>
    </div>
  );
}

export function AgentView({ agentId, onOpen }: { agentId: AgentId; onOpen: (id: string) => void }) {
  const { state, busy, send, stop, clearChat } = useApp();
  const agent = agentById(agentId);
  const messages = state.chats[agentId];
  const isBusy = busy[agentId];
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (text: string) => {
    if (!text.trim() || isBusy) return;
    stickToBottom.current = true;
    send(agentId, text);
    setDraft("");
    if (input.current) input.current.style.height = "auto";
  };

  const deliverables = state.deliverables.filter((d) => d.agentId === agentId).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="agent-view">
      <section className="chat">
        <header className="chat-head">
          <AgentIcon id={agentId} size={40} />
          <div className="chat-head-text">
            <h1>{agent.name}</h1>
            <p>{agent.role}</p>
          </div>
          {messages.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => clearChat(agentId)}>
              <MessageSquarePlus size={16} /> Nouvelle conversation
            </button>
          )}
        </header>

        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-empty">
              <AgentIcon id={agentId} size={56} />
              <h2>Que puis-je faire pour {state.store.name} ?</h2>
              <p>{agent.description}</p>
              <div className="suggestions">
                {agent.suggestions.map((s) => (
                  <button type="button" key={s} className="suggestion" onClick={() => submit(s)}>
                    <span>{s}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div className="msg msg-user" key={m.id}>
                    <div className="bubble">{m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")}</div>
                  </div>
                ) : (
                  <AssistantMessage key={m.id} message={m} agentId={agentId} onOpen={onOpen} />
                ),
              )}
            </div>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder="Écrivez votre demande…"
            aria-label={`Message pour l'${agent.name}`}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
          />
          {isBusy ? (
            <button type="button" className="btn btn-send btn-stop" onClick={() => stop(agentId)} aria-label="Arrêter">
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="btn btn-send" style={{ background: agent.color }} disabled={!draft.trim()} aria-label="Envoyer">
              <Send size={17} />
            </button>
          )}
        </form>
      </section>

      <aside className="panel">
        <header className="panel-head">
          <h2>Livrables</h2>
          <span className="count">{deliverables.length}</span>
        </header>
        <div className="panel-scroll">
          {deliverables.length === 0 ? (
            <p className="panel-empty">Les contenus créés par cet agent apparaîtront ici : vous pourrez les relire, les copier et les valider.</p>
          ) : (
            deliverables.map((d) => <DeliverableCard key={d.id} d={d} onOpen={onOpen} />)
          )}
        </div>
      </aside>
    </div>
  );
}
