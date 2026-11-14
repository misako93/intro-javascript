"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type T } from "@/lib/i18n";

const I18nContext = createContext<T>(makeT("fr"));

/** Langue de l'interface (français pour le personnel, langue du client pour les clients). */
export function I18nProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
  const t = useMemo(() => makeT(locale), [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
