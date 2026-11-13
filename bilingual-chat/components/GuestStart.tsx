"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LanguageSelect from "@/components/LanguageSelect";
import { LANGUAGES, baseOf } from "@/lib/languages";
import { makeT, RTL_LOCALES, uiLocale } from "@/lib/i18n";

/** Langue du téléphone du client → langue proposée par défaut. */
function guessLanguage(fallback: string) {
  if (typeof navigator === "undefined") return fallback;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const base = LANGUAGES.find((l) => l.code === baseOf(tag.toLowerCase()));
    if (base) return base.code;
  }
  return fallback;
}

type Props = { token: string; hotelName: string; roomLabel: string | null; hotelLang?: string; appName: string };

/**
 * Le client scanne le QR → choisit sa langue (pré-remplie) → écrit. Aucun compte, aucun e-mail :
 * une session "invité" Supabase est créée en arrière-plan.
 */
export default function GuestStart({ token, hotelName, roomLabel, appName }: Props) {
  const [lang, setLang] = useState("en");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => setLang(guessLanguage("en")), []);

  const locale = uiLocale(lang);
  const t = useMemo(() => makeT(locale), [locale]);
  const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStatus("busy");
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: name.trim() ? { full_name: name.trim() } : {} },
      });
      if (error) {
        console.error(error);
        setStatus("error");
        return;
      }
    }
    const { data: roomId, error } = await supabase.rpc("start_hotel_conversation", {
      p_token: token,
      p_name: name.trim(),
      p_lang: lang,
    });
    if (error || !roomId) {
      console.error(error);
      setStatus("error");
      return;
    }
    window.location.assign(`/chat/${roomId}`);
  }

  return (
    <main dir={dir} lang={locale} className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-emerald-50 to-slate-50 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-5xl">🛎️</p>
          <h1 className="mt-3 text-2xl font-bold">{hotelName}</h1>
          <p className="mt-1 font-medium text-emerald-700">{roomLabel ? t("room", { label: roomLabel }) : t("desk")}</p>
          <p className="mt-3 text-slate-600">{t("start_subtitle")}</p>
        </div>

        <form onSubmit={start} className="space-y-4 rounded-3xl bg-white p-6 shadow-xl shadow-emerald-900/5 ring-1 ring-slate-100">
          <label className="block text-sm font-medium text-slate-700">
            {t("your_language")}
            <LanguageSelect native value={lang} onChange={setLang} className="mt-1 w-full py-3" aria-label={t("your_language")} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t("your_name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="given-name"
              dir="auto"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <button
            type="submit"
            disabled={status === "busy"}
            className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {status === "busy" ? "…" : `💬 ${t("start_button")}`}
          </button>
          {status === "error" && <p className="text-center text-sm text-red-600">{t("start_error")}</p>}
        </form>
        <p className="mt-6 text-center text-xs text-slate-400" dir="ltr">{appName}</p>
      </div>
    </main>
  );
}
