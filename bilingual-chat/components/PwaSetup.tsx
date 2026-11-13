"use client";

import { useEffect } from "react";
import type { InstallPromptEvent } from "@/lib/pwa";

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
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
