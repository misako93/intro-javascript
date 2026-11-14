"use client";

import { useState } from "react";

/** Copier un lien / l'envoyer par WhatsApp (ex. lien d'invitation d'un réceptionniste). */
export default function CopyLink({ url, message }: { url: string; message: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copiez ce lien :", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={copy} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200">
        {copied ? "Lien copié ✓" : "Copier le lien"}
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`}
        target="_blank"
        rel="noopener"
        className="rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
      >
        Envoyer par WhatsApp
      </a>
    </div>
  );
}
