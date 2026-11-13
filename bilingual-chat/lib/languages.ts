export type Language = {
  /** Identifiant interne (stocké en base) */
  code: string;
  /** Nom affiché (en français) */
  label: string;
  /** Nom de la langue dans la langue elle-même (affiché aux clients étrangers) */
  native: string;
  flag: string;
  /** Code ISO-639-1 attendu par Whisper */
  whisper: string;
  /** Description précise donnée à l'IA de traduction */
  prompt: string;
  /** Code BCP-47 pour la lecture à voix haute du navigateur */
  speech: string;
  rtl?: boolean;
};

export const LANGUAGES: Language[] = [
  { code: "fr", native: "Français", label: "Français", flag: "🇫🇷", whisper: "fr", speech: "fr-FR", prompt: "French" },
  { code: "en", native: "English", label: "Anglais", flag: "🇬🇧", whisper: "en", speech: "en-US", prompt: "English" },
  { code: "ar", native: "العربية", label: "Arabe (standard)", flag: "🌐", whisper: "ar", speech: "ar-SA", rtl: true, prompt: "Modern Standard Arabic (Fusha), in Arabic script" },
  { code: "ar-EG", native: "العربية المصرية", label: "Arabe égyptien", flag: "🇪🇬", whisper: "ar", speech: "ar-EG", rtl: true, prompt: "Egyptian Arabic (Masri), the colloquial dialect spoken in Cairo, written in Arabic script" },
  { code: "ar-SA", native: "العربية السعودية", label: "Arabe saoudien", flag: "🇸🇦", whisper: "ar", speech: "ar-SA", rtl: true, prompt: "Saudi Arabic, the colloquial dialect spoken in Riyadh and Jeddah (Najdi/Hijazi), written in Arabic script" },
  { code: "ar-AE", native: "العربية الخليجية", label: "Arabe du Golfe", flag: "🇦🇪", whisper: "ar", speech: "ar-AE", rtl: true, prompt: "Gulf Arabic (Khaleeji) as spoken in the UAE, Kuwait and Qatar, written in Arabic script" },
  { code: "ar-MA", native: "الدارجة المغربية", label: "Darija marocaine", flag: "🇲🇦", whisper: "ar", speech: "ar-MA", rtl: true, prompt: "Moroccan Arabic (Darija), written in Arabic script" },
  { code: "ar-DZ", native: "الدارجة الجزائرية", label: "Arabe algérien", flag: "🇩🇿", whisper: "ar", speech: "ar-DZ", rtl: true, prompt: "Algerian Arabic (Darja), written in Arabic script" },
  { code: "ar-TN", native: "التونسية", label: "Arabe tunisien", flag: "🇹🇳", whisper: "ar", speech: "ar-TN", rtl: true, prompt: "Tunisian Arabic (Derja), written in Arabic script" },
  { code: "ar-LB", native: "الشامية", label: "Arabe levantin", flag: "🇱🇧", whisper: "ar", speech: "ar-LB", rtl: true, prompt: "Levantine Arabic (Lebanese/Syrian/Palestinian colloquial), written in Arabic script" },
  { code: "es", native: "Español", label: "Espagnol", flag: "🇪🇸", whisper: "es", speech: "es-ES", prompt: "Spanish" },
  { code: "it", native: "Italiano", label: "Italien", flag: "🇮🇹", whisper: "it", speech: "it-IT", prompt: "Italian" },
  { code: "de", native: "Deutsch", label: "Allemand", flag: "🇩🇪", whisper: "de", speech: "de-DE", prompt: "German" },
  { code: "pt", native: "Português", label: "Portugais", flag: "🇵🇹", whisper: "pt", speech: "pt-PT", prompt: "Portuguese" },
  { code: "nl", native: "Nederlands", label: "Néerlandais", flag: "🇳🇱", whisper: "nl", speech: "nl-NL", prompt: "Dutch" },
  { code: "tr", native: "Türkçe", label: "Turc", flag: "🇹🇷", whisper: "tr", speech: "tr-TR", prompt: "Turkish" },
  { code: "ru", native: "Русский", label: "Russe", flag: "🇷🇺", whisper: "ru", speech: "ru-RU", prompt: "Russian" },
  { code: "fa", native: "فارسی", label: "Persan", flag: "🇮🇷", whisper: "fa", speech: "fa-IR", rtl: true, prompt: "Persian (Farsi)" },
  { code: "ur", native: "اردو", label: "Ourdou", flag: "🇵🇰", whisper: "ur", speech: "ur-PK", rtl: true, prompt: "Urdu, in Urdu (Nastaliq) script" },
  { code: "hi", native: "हिन्दी", label: "Hindi", flag: "🇮🇳", whisper: "hi", speech: "hi-IN", prompt: "Hindi, in Devanagari script" },
  { code: "bn", native: "বাংলা", label: "Bengali", flag: "🇧🇩", whisper: "bn", speech: "bn-BD", prompt: "Bengali" },
  { code: "id", native: "Bahasa Indonesia", label: "Indonésien", flag: "🇮🇩", whisper: "id", speech: "id-ID", prompt: "Indonesian" },
  { code: "ms", native: "Bahasa Melayu", label: "Malais", flag: "🇲🇾", whisper: "ms", speech: "ms-MY", prompt: "Malay" },
  { code: "tl", native: "Tagalog", label: "Tagalog", flag: "🇵🇭", whisper: "tl", speech: "fil-PH", prompt: "Tagalog (Filipino)" },
  { code: "zh", native: "中文", label: "Chinois", flag: "🇨🇳", whisper: "zh", speech: "zh-CN", prompt: "Simplified Chinese (Mandarin)" },
  { code: "sw", native: "Kiswahili", label: "Swahili", flag: "🇰🇪", whisper: "sw", speech: "sw-KE", prompt: "Swahili" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string | null | undefined): Language {
  return BY_CODE.get(code ?? "") ?? LANGUAGES[0];
}

export function isLanguage(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

/** "ar-EG" → "ar" */
export function baseOf(code: string) {
  return code.split("-")[0];
}

/**
 * Deux langues sont "identiques" (= pas besoin de traduire) si elles ont le même code,
 * ou la même langue de base quand l'une des deux n'a pas de dialecte précis.
 * Ex. : fr = fr ✓ · ar = ar-EG ✓ · ar-EG ≠ ar-MA (dialectes choisis explicitement) · fr ≠ en.
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  if (a === b) return true;
  return baseOf(a) === baseOf(b) && (a === baseOf(a) || b === baseOf(b));
}

/** Un message sans aucune lettre (emoji, chiffres, "👍") n'a rien à traduire. */
export function hasLetters(text: string) {
  return /\p{L}/u.test(text);
}

/** Code ISO-639-1 ("fr", "ar"…) → code de l'application, si la langue est prise en charge. */
export function fromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const code = iso.toLowerCase();
  return BY_CODE.has(code) ? code : null;
}

/** Pays arabophones → dialecte proposé par défaut. */
const ARABIC_BY_COUNTRY: Record<string, string> = {
  SA: "ar-SA",
  EG: "ar-EG", SD: "ar-EG",
  AE: "ar-AE", QA: "ar-AE", KW: "ar-AE", BH: "ar-AE", OM: "ar-AE",
  MA: "ar-MA", DZ: "ar-DZ", TN: "ar-TN", LY: "ar-TN",
  LB: "ar-LB", SY: "ar-LB", JO: "ar-LB", PS: "ar-LB", IQ: "ar",
};

/** Codes de langue alternatifs envoyés par certains téléphones. */
const ALIASES: Record<string, string> = { fil: "tl", in: "id", iw: "he", nb: "no", zsm: "ms", pes: "fa", prs: "fa" };

/** Une langue du téléphone ("ar-QA", "fil-PH", "pt-BR"…) → langue de l'application, si prise en charge. */
export function matchLanguage(tag: string): string | null {
  const [rawBase, ...rest] = tag.trim().replace("_", "-").split("-");
  const base = ALIASES[rawBase.toLowerCase()] ?? rawBase.toLowerCase();
  const region = rest.find((p) => /^[A-Za-z]{2}$/.test(p))?.toUpperCase();
  if (base === "ar") return (region && ARABIC_BY_COUNTRY[region]) || "ar";
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === `${base}-${region ?? ""}`.toLowerCase());
  if (exact) return exact.code;
  return BY_CODE.has(base) ? base : null;
}

/** Première langue du téléphone prise en charge (navigator.languages ou en-tête Accept-Language). */
export function pickLanguage(tags: readonly string[], fallback = "en"): string {
  for (const tag of tags) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return fallback;
}

/** "fr-FR,fr;q=0.9,en;q=0.8" → ["fr-FR", "fr", "en"], triés par préférence. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag && x.tag !== "*")
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}
