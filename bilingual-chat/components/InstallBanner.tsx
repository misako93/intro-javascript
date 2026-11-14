"use client";

import { useEffect, useState } from "react";
import { isIOS, isStandalone } from "@/lib/pwa";
import { APP_NAME } from "@/lib/config";

const DISMISS_KEY = "install-banner-dismissed";

/** "Installer l'application" : bouton natif sur Android/Chrome, mode d'emploi sur iPhone. */
export default function InstallBanner() {
  const [mode, setMode] = useState<"hidden" | "android" | "ios">("hidden");

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;
    const update = () => setMode(window.__installPrompt ? "android" : isIOS() ? "ios" : "hidden");
    update();
    window.addEventListener("installprompt-ready", update);
    return () => window.removeEventListener("installprompt-ready", update);
  }, []);

  if (mode === "hidden") return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setMode("hidden");
  };

  async function install() {
    const prompt = window.__installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    window.__installPrompt = null;
    setMode("hidden");
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-3xl bg-slate-900 p-4 text-white">
      <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
      <div className="flex-1">
        <p className="font-semibold">Installez {APP_NAME} sur votre téléphone</p>
        {mode === "android" ? (
          <>
            <p className="text-sm text-slate-300">Une icône comme WhatsApp, et les notifications des nouveaux messages.</p>
            <button onClick={install} className="mt-3 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold">
              📲 Installer l’application
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-300">
            Touchez <span className="font-semibold text-white">Partager</span>{" "}
            <svg className="inline h-4 w-4 align-[-2px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>{" "}
            en bas de Safari, puis <span className="font-semibold text-white">« Sur l’écran d’accueil »</span>. Vous recevrez
            ensuite les notifications des nouveaux messages.
          </p>
        )}
      </div>
      <button onClick={dismiss} className="p-1 text-slate-400 hover:text-white" aria-label="Masquer">
        ✕
      </button>
    </div>
  );
}
