"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateAssistant } from "@/app/hotel/actions";
import LanguageSelect from "@/components/LanguageSelect";
import type { AssistantDecision } from "@/lib/assistant";

const EXAMPLE = `Wi-Fi : réseau « Riviera-Guest », mot de passe « soleil2026 »
Petit-déjeuner : 7h00–10h30 au rez-de-chaussée (11h00 le week-end), 18 € par personne
Check-in : à partir de 15h00 · Check-out : avant 11h00
Parking : 15 € la nuit, entrée rue Victor-Hugo
Piscine : 8h00–20h00, serviettes au bord de la piscine
Navette aéroport : sur réservation à la réception, 35 €
Urgence : composez le 9 depuis la chambre, ou le 112`;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-60">
      {pending ? "Enregistrement…" : "Enregistrer"}
    </button>
  );
}

export default function AssistantSettings({
  hotelId,
  enabled,
  info: initialInfo,
  canEdit,
}: {
  hotelId: string;
  enabled: boolean;
  info: string;
  canEdit: boolean;
}) {
  const [info, setInfo] = useState(initialInfo);
  const [question, setQuestion] = useState("What is the wifi password?");
  const [guestLang, setGuestLang] = useState("en");
  const [result, setResult] = useState<{ decision?: AssistantDecision; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    setResult(null);
    const res = await fetch("/api/assistant/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, guestLang, info }),
    }).catch(() => null);
    setResult(res ? await res.json().catch(() => ({ error: "Erreur" })) : { error: "Erreur réseau" });
    setTesting(false);
  }

  return (
    <div className="space-y-5">
      <form action={updateAssistant} className="space-y-3">
        <input type="hidden" name="hotel_id" value={hotelId} />
        <label className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3 font-medium text-emerald-900">
          <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={!canEdit} className="h-5 w-5 accent-emerald-600" />
          Activer les réponses automatiques
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Infos pratiques de l’hôtel <span className="font-normal text-slate-400">(l’IA ne répond qu’avec ces informations)</span>
          <textarea
            name="info"
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            readOnly={!canEdit}
            rows={9}
            maxLength={8000}
            placeholder={EXAMPLE}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <SaveButton />
            {!info && (
              <button type="button" onClick={() => setInfo(EXAMPLE)} className="text-sm text-emerald-700 underline">
                Partir d’un exemple
              </button>
            )}
          </div>
        )}
      </form>

      {/* Zone de test : idéale aussi pour une démonstration devant un directeur d'hôtel */}
      <div className="rounded-2xl border border-slate-200 p-4">
        <p className="font-semibold">🧪 Tester comme un client</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <LanguageSelect value={guestLang} onChange={setGuestLang} className="sm:w-48" aria-label="Langue du client" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            dir="auto"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-emerald-500"
            placeholder="Question du client…"
          />
          <button onClick={test} disabled={testing || !question.trim()} className="rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
            {testing ? "…" : "Tester"}
          </button>
        </div>
        {result?.error && <p className="mt-3 text-sm text-red-600">{result.error}</p>}
        {result?.decision && (
          <div className="mt-3 space-y-2 text-sm">
            {result.decision.action === "answer" ? (
              <p className="font-semibold text-emerald-700">✅ L’IA répond seule — la réception n’est pas dérangée</p>
            ) : (
              <p className="font-semibold text-amber-700">
                📨 Transmis à la réception (son téléphone sonne)
                {result.decision.ack ? " — le client est prévenu" : ""}
              </p>
            )}
            {result.decision.reply_guest && (
              <>
                <p className="rounded-xl bg-slate-50 p-3" dir="auto">
                  <span className="text-xs text-slate-400">Le client lit :</span>
                  <br />
                  {result.decision.reply_guest}
                </p>
                {result.decision.reply_staff && result.decision.reply_staff !== result.decision.reply_guest && (
                  <p className="rounded-xl bg-slate-50 p-3">
                    <span className="text-xs text-slate-400">En français :</span>
                    <br />
                    {result.decision.reply_staff}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
