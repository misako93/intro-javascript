"use client";

import { useEffect } from "react";
import type { InstallPromptEvent } from "@/lib/pwa";
import { unlockAudio } from "@/lib/sound";

/** Enregistre le service worker et garde de côté l'invite d'installation Android. */
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW", err));
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as InstallPromptEvent;
      window.dispatchEvent(new Event("installprompt-ready"));
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      window.dispatchEvent(new Event("installprompt-ready"));
    };
    // Débloque le son des alertes au premier toucher de l'écran
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
