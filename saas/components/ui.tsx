"use client";

import { Check, CircleAlert, CircleCheck, Clapperboard, Copy, Mail, Search, TriangleAlert, Wrench } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { agentById } from "@/lib/agents";
import type { AgentId, CheckStatus } from "@/lib/types";

const AGENT_ICONS = { webmaster: Wrench, seo: Search, email: Mail, social: Clapperboard } as const;

export function AgentIcon({ id, size = 36 }: { id: AgentId; size?: number }) {
  const Icon = AGENT_ICONS[id];
  return (
    <span className="agent-icon" style={{ width: size, height: size, background: agentById(id).color }} aria-hidden>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: label, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard unavailable (insecure context): nothing to do.
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Copié" : label}
    </button>
  );
}

export function scoreTone(score: number): "ok" | "warn" | "error" {
  return score >= 80 ? "ok" : score >= 50 ? "warn" : "error";
}

export function ScorePill({ score }: { score: number }) {
  return <span className={`score-pill tone-${scoreTone(score)}`}>{score}/100</span>;
}

export function ScoreRing({ score, size = 76 }: { score: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`score-ring tone-${scoreTone(score)}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} className="score-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="score-ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{score}</span>
    </div>
  );
}

export function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CircleCheck size={16} className="tone-text-ok" aria-label="OK" />;
  if (status === "warn") return <TriangleAlert size={16} className="tone-text-warn" aria-label="À améliorer" />;
  return <CircleAlert size={16} className="tone-text-error" aria-label="À corriger" />;
}
