"use client";

/**
 * Petit carillon "ding-dong" généré par le navigateur (aucun fichier audio à charger).
 * Utilisé quand l'application est ouverte au premier plan ; en arrière-plan,
 * c'est la notification push du téléphone qui sonne.
 */
let ctx: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** À appeler sur un geste de l'utilisateur : iOS/Chrome bloquent le son tant qu'on n'a pas touché l'écran. */
export function unlockAudio() {
  const c = getContext();
  if (c?.state === "suspended") c.resume().catch(() => {});
}

export function playChime(kind: "message" | "join" = "message") {
  const c = getContext();
  if (!c || c.state !== "running") return;
  const notes = kind === "join" ? [659.25, 830.61, 987.77] : [880, 659.25]; // mi-sol#-si / la-mi
  notes.forEach((freq, i) => {
    const start = c.currentTime + i * 0.16;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });
  if ("vibrate" in navigator) navigator.vibrate?.(kind === "join" ? [200, 100, 200] : 120);
}
