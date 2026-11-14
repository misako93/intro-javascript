"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createRoom } from "@/app/dashboard/actions";
import LanguageSelect from "@/components/LanguageSelect";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
    >
      {pending ? "Création…" : "Créer et inviter"}
    </button>
  );
}

export default function NewRoomForm({ defaultMyLang = "fr", defaultTargetLang = "ar-EG" }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 active:scale-[0.99]"
      >
        <span className="text-xl leading-none">+</span> Créer une nouvelle conversation bilingue
      </button>
    );
  }

  return (
    <form action={createRoom} className="space-y-4 rounded-3xl bg-white p-5 shadow-lg ring-1 ring-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Nouvelle conversation</h2>
        <button type="button" onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Fermer">
          ✕
        </button>
      </div>

      <div>
        <label htmlFor="partner_name" className="mb-1 block text-sm font-medium text-slate-700">
          Avec qui allez-vous discuter ?
        </label>
        <input
          id="partner_name"
          name="partner_name"
          required
          maxLength={60}
          autoFocus
          placeholder="Ex : Ahmed, Fatima, Mon fournisseur…"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="my_lang" className="mb-1 block text-sm font-medium text-slate-700">
            Ma langue
          </label>
          <LanguageSelect id="my_lang" name="my_lang" defaultValue={defaultMyLang} className="w-full" />
        </div>
        <div>
          <label htmlFor="target_lang" className="mb-1 block text-sm font-medium text-slate-700">
            Sa langue
          </label>
          <LanguageSelect id="target_lang" name="target_lang" defaultValue={defaultTargetLang} className="w-full" />
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
