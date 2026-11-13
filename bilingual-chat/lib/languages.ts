export type Language = {
  /** Identifiant interne (stocké en base) */
  code: string;
  /** Nom affiché (en français) */
  label: string;
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
  { code: "fr", label: "Français", flag: "🇫🇷", whisper: "fr", speech: "fr-FR", prompt: "French" },
  { code: "en", label: "Anglais", flag: "🇬🇧", whisper: "en", speech: "en-US", prompt: "English" },
  { code: "ar", label: "Arabe (standard)", flag: "🌐", whisper: "ar", speech: "ar-SA", rtl: true, prompt: "Modern Standard Arabic (Fusha), in Arabic script" },
  { code: "ar-EG", label: "Arabe égyptien", flag: "🇪🇬", whisper: "ar", speech: "ar-EG", rtl: true, prompt: "Egyptian Arabic (Masri), the colloquial dialect spoken in Cairo, written in Arabic script" },
  { code: "ar-SA", label: "Arabe saoudien", flag: "🇸🇦", whisper: "ar", speech: "ar-SA", rtl: true, prompt: "Saudi Arabic, the colloquial dialect spoken in Riyadh and Jeddah (Najdi/Hijazi), written in Arabic script" },
  { code: "ar-AE", label: "Arabe du Golfe", flag: "🇦🇪", whisper: "ar", speech: "ar-AE", rtl: true, prompt: "Gulf Arabic (Khaleeji) as spoken in the UAE, Kuwait and Qatar, written in Arabic script" },
  { code: "ar-MA", label: "Darija marocaine", flag: "🇲🇦", whisper: "ar", speech: "ar-MA", rtl: true, prompt: "Moroccan Arabic (Darija), written in Arabic script" },
  { code: "ar-DZ", label: "Arabe algérien", flag: "🇩🇿", whisper: "ar", speech: "ar-DZ", rtl: true, prompt: "Algerian Arabic (Darja), written in Arabic script" },
  { code: "ar-TN", label: "Arabe tunisien", flag: "🇹🇳", whisper: "ar", speech: "ar-TN", rtl: true, prompt: "Tunisian Arabic (Derja), written in Arabic script" },
  { code: "ar-LB", label: "Arabe levantin", flag: "🇱🇧", whisper: "ar", speech: "ar-LB", rtl: true, prompt: "Levantine Arabic (Lebanese/Syrian/Palestinian colloquial), written in Arabic script" },
  { code: "es", label: "Espagnol", flag: "🇪🇸", whisper: "es", speech: "es-ES", prompt: "Spanish" },
  { code: "it", label: "Italien", flag: "🇮🇹", whisper: "it", speech: "it-IT", prompt: "Italian" },
  { code: "de", label: "Allemand", flag: "🇩🇪", whisper: "de", speech: "de-DE", prompt: "German" },
  { code: "pt", label: "Portugais", flag: "🇵🇹", whisper: "pt", speech: "pt-PT", prompt: "Portuguese" },
  { code: "nl", label: "Néerlandais", flag: "🇳🇱", whisper: "nl", speech: "nl-NL", prompt: "Dutch" },
  { code: "tr", label: "Turc", flag: "🇹🇷", whisper: "tr", speech: "tr-TR", prompt: "Turkish" },
  { code: "ru", label: "Russe", flag: "🇷🇺", whisper: "ru", speech: "ru-RU", prompt: "Russian" },
  { code: "fa", label: "Persan", flag: "🇮🇷", whisper: "fa", speech: "fa-IR", rtl: true, prompt: "Persian (Farsi)" },
  { code: "ur", label: "Ourdou", flag: "🇵🇰", whisper: "ur", speech: "ur-PK", rtl: true, prompt: "Urdu, in Urdu (Nastaliq) script" },
  { code: "hi", label: "Hindi", flag: "🇮🇳", whisper: "hi", speech: "hi-IN", prompt: "Hindi, in Devanagari script" },
  { code: "bn", label: "Bengali", flag: "🇧🇩", whisper: "bn", speech: "bn-BD", prompt: "Bengali" },
  { code: "id", label: "Indonésien", flag: "🇮🇩", whisper: "id", speech: "id-ID", prompt: "Indonesian" },
  { code: "ms", label: "Malais", flag: "🇲🇾", whisper: "ms", speech: "ms-MY", prompt: "Malay" },
  { code: "tl", label: "Tagalog", flag: "🇵🇭", whisper: "tl", speech: "fil-PH", prompt: "Tagalog (Filipino)" },
  { code: "zh", label: "Chinois", flag: "🇨🇳", whisper: "zh", speech: "zh-CN", prompt: "Simplified Chinese (Mandarin)" },
  { code: "sw", label: "Swahili", flag: "🇰🇪", whisper: "sw", speech: "sw-KE", prompt: "Swahili" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string | null | undefined): Language {
  return BY_CODE.get(code ?? "") ?? LANGUAGES[0];
}

export function isLanguage(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}
