import { detectAll } from "tinyld";
import { baseOf, fromIso, hasLetters } from "@/lib/languages";

/**
 * Détecte la langue RÉELLE d'un message (le client peut écrire dans une autre langue
 * que celle de son profil, ex. un client arabophone qui écrit en français à la réception).
 *
 * - `senderLang` : langue paramétrée de l'expéditeur (valeur de repli)
 * - `recipientLangs` : langues des destinataires (langues "attendues" dans cette conversation)
 * - `hintIso` : langue déjà détectée par Whisper pour un vocal (prioritaire si plausible)
 *
 * Renvoie un code de l'application (ex. "fr", "ar-EG").
 */
export function detectMessageLanguage(
  text: string,
  senderLang: string,
  recipientLangs: string[],
  hintIso?: string | null,
): string {
  if (!hasLetters(text)) return senderLang;

  const expected = [senderLang, ...recipientLangs];
  // Garde le code précis (dialecte) de la conversation quand la langue de base correspond.
  const toAppCode = (iso: string) => expected.find((l) => baseOf(l) === iso) ?? fromIso(iso);

  // 1. Langue renvoyée par Whisper (vocaux)
  const hint = hintIso ? toAppCode(hintIso) : null;
  if (hint) return hint;

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const candidates = detectAll(text);
  if (!candidates.length) return senderLang;

  const top = candidates[0];
  const second = candidates[1];
  const isExpected = (iso: string) => expected.some((l) => baseOf(l) === iso);

  // 2. La langue la plus probable est l'une des langues de la conversation → fiable.
  if (isExpected(top.lang)) return toAppCode(top.lang) ?? senderLang;

  // 3. Texte court ("oui", "merci") : la détection est fragile, on privilégie une langue
  //    de la conversation si elle figure parmi les 3 meilleurs candidats.
  if (letters < 12) {
    const plausible = candidates.slice(0, 3).find((c) => isExpected(c.lang));
    return plausible ? (toAppCode(plausible.lang) ?? senderLang) : senderLang;
  }

  // 4. Texte long dans une 3e langue : on l'accepte seulement si la détection est nette.
  const dominant = !second || top.accuracy >= 2 * second.accuracy;
  return (dominant && fromIso(top.lang)) || senderLang;
}

/** Whisper (verbose_json) renvoie le nom anglais de la langue → code ISO-639-1. */
const WHISPER_NAMES: Record<string, string> = {
  french: "fr", english: "en", arabic: "ar", spanish: "es", italian: "it", german: "de",
  portuguese: "pt", dutch: "nl", turkish: "tr", russian: "ru", persian: "fa", urdu: "ur",
  hindi: "hi", bengali: "bn", indonesian: "id", malay: "ms", tagalog: "tl", chinese: "zh",
  swahili: "sw",
};

export function whisperLanguageToIso(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  return WHISPER_NAMES[n] ?? (n.length === 2 ? n : null);
}
