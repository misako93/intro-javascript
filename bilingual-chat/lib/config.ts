export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Tarjem";
export const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
export const VOICE_BUCKET = "voice-messages";
export const MAX_RECORDING_SECONDS = 120;

/** Prix affiché sur le bouton d'abonnement (le vrai prix est défini dans Stripe). */
export const PRICE_LABEL = process.env.NEXT_PUBLIC_PRICE_LABEL || "9,99 € / mois";
/** Clé publique VAPID pour les notifications push. */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
