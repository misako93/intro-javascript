"use client";

import { useApp } from "@/lib/client/state";
import type { BrandBrief } from "@/lib/types";

const FIELDS: { key: keyof BrandBrief; label: string; help: string }[] = [
  { key: "audience", label: "À qui vous parlez", help: "Votre cliente type : son âge, son pays, ce qu'elle cherche, ce qui la fait hésiter." },
  { key: "voice", label: "Votre voix", help: "Tutoiement ou vouvoiement, le ton, les tournures qui vous ressemblent." },
  { key: "promise", label: "Ce qui vous distingue", help: "La raison concrète de vous choisir plutôt qu'un concurrent." },
  {
    key: "facts",
    label: "Informations pratiques vérifiées",
    help: "Livraison, retours, paiement, origine. Vos agents n'affirment rien d'autre sur ces sujets : ce qui n'est pas écrit ici, ils ne l'inventent pas.",
  },
  { key: "avoid", label: "À ne jamais écrire", help: "Les promesses interdites, les mots que vous ne voulez pas voir." },
];

/** The brand brief every agent reads before writing. */
export function BrandView() {
  const { state, updateBrand } = useApp();
  const brand = state.store.brand;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Brief de marque</h1>
          <p className="muted">
            Ce que vos quatre agents savent de {state.store.name} avant d&apos;écrire une ligne. Modifiez-le : ils en tiennent compte dès la demande suivante.
          </p>
        </div>
      </header>
      <div className="brief">
        {FIELDS.map((field) => (
          <div className="brief-field" key={field.key}>
            <label htmlFor={`brand-${field.key}`}>{field.label}</label>
            <small>{field.help}</small>
            <textarea
              id={`brand-${field.key}`}
              rows={3}
              maxLength={1500}
              value={brand[field.key]}
              onChange={(e) => updateBrand({ [field.key]: e.target.value })}
            />
          </div>
        ))}
        <p className="muted">Enregistré automatiquement dans ce navigateur.</p>
      </div>
    </div>
  );
}
