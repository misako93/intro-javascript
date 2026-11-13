"use client";

import { useState } from "react";
import { APP_NAME } from "@/lib/config";

function inviteText(url: string) {
  return `Rejoins-moi sur ${APP_NAME} : on discute chacun dans sa langue, la traduction est automatique 🌍\n${url}`;
}

function useInvite(token: string) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}/invite/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
    } catch {
      window.prompt("Copiez ce lien :", url());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: APP_NAME, text: inviteText(url()) });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    await copy();
  }

  function whatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteText(url()))}`, "_blank", "noopener");
  }

  return { copied, copy, share, whatsapp };
}

/** Petit bouton pour l'en-tête du chat. */
export function InviteButton({ token }: { token: string }) {
  const { copied, share } = useInvite(token);
  return (
    <button
      onClick={share}
      className="shrink-0 rounded-full bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
    >
      {copied ? "Lien copié ✓" : "Inviter"}
    </button>
  );
}

/** Grand encart affiché tant que l'interlocuteur n'a pas rejoint. */
export function InviteCard({ token, partnerName }: { token: string; partnerName: string }) {
  const { copied, copy, whatsapp } = useInvite(token);
  return (
    <div className="mx-auto my-4 max-w-md rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-100">
      <p className="text-3xl">👋</p>
      <h2 className="mt-2 font-semibold">{partnerName} n’a pas encore rejoint la conversation</h2>
      <p className="mt-1 text-sm text-slate-500">
        Envoyez-lui ce lien. Il ou elle se connectera en 1 clic et arrivera directement ici.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          onClick={whatsapp}
          className="rounded-2xl bg-[#25D366] px-4 py-3 font-semibold text-white transition hover:brightness-95"
        >
          Envoyer par WhatsApp
        </button>
        <button
          onClick={copy}
          className="rounded-2xl bg-slate-100 px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-200"
        >
          {copied ? "Lien copié ✓" : "Copier le lien (SMS…)"}
        </button>
      </div>
    </div>
  );
}
