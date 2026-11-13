"use client";

import { useEffect, useState } from "react";
import { enablePush, isIOS, isStandalone, pushSupported, syncPushSubscription } from "@/lib/pwa";
import { VAPID_PUBLIC_KEY } from "@/lib/config";

const DISMISS_KEY = "notif-banner-dismissed";

/** Propose d'activer les notifications (indispensable pour une messagerie). */
export default function NotificationsBanner({ partnerName }: { partnerName: string }) {
  const [state, setState] = useState<"hidden" | "ask" | "ios-install" | "busy" | "denied">("hidden");

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || localStorage.getItem(DISMISS_KEY)) return;
    if (isIOS() && !isStandalone()) {
      setState("ios-install"); // sur iPhone, les notifications web exigent l'app installée
      return;
    }
    if (!pushSupported()) return;
    if (Notification.permission === "granted") {
      syncPushSubscription().catch(() => {});
      return;
    }
    if (Notification.permission === "default") setState("ask");
  }, []);

  if (state === "hidden") return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setState("hidden");
  };

  async function activate() {
    setState("busy");
    const ok = await enablePush().catch(() => false);
    setState(ok ? "hidden" : "denied");
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <span className="text-lg">🔔</span>
      <p className="flex-1">
        {state === "ios-install"
          ? "Pour être prévenu·e des messages sur iPhone : Partager → « Sur l’écran d’accueil », puis ouvrez l’app depuis l’icône."
          : state === "denied"
            ? "Notifications bloquées. Autorisez-les dans les réglages du navigateur."
            : `Soyez prévenu·e quand ${partnerName} vous répond.`}
      </p>
      {(state === "ask" || state === "busy") && (
        <button
          onClick={activate}
          disabled={state === "busy"}
          className="shrink-0 rounded-full bg-amber-500 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
        >
          Activer
        </button>
      )}
      <button onClick={dismiss} className="shrink-0 p-1 text-amber-700" aria-label="Masquer">
        ✕
      </button>
    </div>
  );
}
