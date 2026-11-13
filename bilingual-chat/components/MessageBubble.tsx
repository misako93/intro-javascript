"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getLanguage, hasLetters, sameLanguage } from "@/lib/languages";
import { VOICE_BUCKET } from "@/lib/config";
import { formatTime } from "@/lib/utils";
import { useT } from "@/components/I18n";
import type { Message } from "@/lib/types";

const AUTO_RETRY_AFTER_MS = 12_000; // si la traduction n'est pas arrivée, on la redemande
const AUTO_RETRY_MAX_AGE_MS = 10 * 60_000; // …seulement pour les messages récents

type Props = {
  message: Message;
  mine: boolean;
  /** Langue dans laquelle afficher la traduction pour moi */
  wantedLang: string;
  onTranslate: (messageId: string, lang: string) => Promise<boolean>;
};

function speak(text: string, langCode: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const lang = getLanguage(langCode).speech;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(lang.split("-")[0]));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function AudioPlayer({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .storage.from(VOICE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 6)
      .then(({ data }) => !cancelled && data && setSrc(data.signedUrl));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!src) return <div className="h-10 w-56 animate-pulse rounded-full bg-black/5" />;
  return <audio controls preload="metadata" src={src} className="h-10 w-56 max-w-full" />;
}

export default function MessageBubble({ message, mine, wantedLang, onTranslate }: Props) {
  const t = useT();
  const [retry, setRetry] = useState<"idle" | "loading" | "failed">("idle");
  const fromLang = message.detected_lang || message.source_lang;
  const source = getLanguage(fromLang);
  const target = getLanguage(wantedLang);
  // Même langue que le lecteur (ou rien à traduire) → on n'affiche que l'original.
  const needsTranslation = hasLetters(message.original_text || "x") && !sameLanguage(fromLang, wantedLang);
  const translation = message.translations?.[wantedLang];
  const isReady = message.status === "ready" && message.original_text.trim() !== "";

  async function requestTranslation() {
    setRetry("loading");
    const ok = await onTranslate(message.id, wantedLang);
    setRetry(ok ? "idle" : "failed");
  }

  // Filet de sécurité : si la traduction n'arrive pas, on la redemande automatiquement une fois.
  useEffect(() => {
    if (!needsTranslation || translation || !isReady || retry !== "idle") return;
    const age = Date.now() - new Date(message.created_at).getTime();
    if (age > AUTO_RETRY_MAX_AGE_MS) return;
    const timer = setTimeout(requestTranslation, Math.max(0, AUTO_RETRY_AFTER_MS - age));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTranslation, translation, isReady, retry, message.id, wantedLang]);

  const age = Date.now() - new Date(message.created_at).getTime();
  const showManualButton = retry === "failed" || (retry === "idle" && age > AUTO_RETRY_MAX_AGE_MS);

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
          mine ? "rounded-br-md bg-emerald-600 text-white" : "rounded-bl-md bg-white text-slate-900"
        }`}
      >
        {/* Message original */}
        {message.kind === "audio" && message.audio_path && (
          <div className="mb-1.5">
            <AudioPlayer path={message.audio_path} />
          </div>
        )}

        {message.status === "processing" && (
          <p className={`text-sm italic ${mine ? "text-emerald-100" : "text-slate-400"}`}>
            <span className="inline-block animate-pulse">{t("transcribing")}</span>
          </p>
        )}
        {message.status === "error" && (
          <p className={`text-sm italic ${mine ? "text-emerald-100" : "text-red-500"}`}>
            {t("voice_failed")}
          </p>
        )}
        {message.original_text && (
          <p dir="auto" className={`whitespace-pre-wrap break-words ${message.kind === "audio" ? "text-[15px]" : "text-base"}`}>
            {message.original_text}
          </p>
        )}

        {/* Traduction */}
        {needsTranslation && isReady && (
          <div className={`mt-2 border-t pt-2 ${mine ? "border-white/25" : "border-slate-100"}`}>
            {translation ? (
              <div className="flex items-start gap-2">
                <p
                  dir={target.rtl ? "rtl" : "auto"}
                  className={`flex-1 whitespace-pre-wrap break-words ${
                    mine ? "text-[15px] text-emerald-50" : "text-base font-medium text-emerald-800"
                  }`}
                >
                  {translation}
                </p>
                <button
                  onClick={() => speak(translation, wantedLang)}
                  className={`shrink-0 rounded-full p-1 text-sm ${mine ? "hover:bg-white/15" : "hover:bg-slate-100"}`}
                  aria-label={t("listen")}
                  title={t("listen")}
                >
                  🔊
                </button>
              </div>
            ) : showManualButton ? (
              <button
                onClick={requestTranslation}
                className={`text-sm font-medium underline ${mine ? "text-emerald-50" : "text-emerald-700"}`}
              >
                {retry === "failed" ? t("translate_failed") : t("translate", { lang: target.label })}
              </button>
            ) : (
              <p className={`animate-pulse text-sm italic ${mine ? "text-emerald-100" : "text-slate-400"}`}>
                {t("translating", { lang: target.label })}
              </p>
            )}
          </div>
        )}

        <p className={`mt-1 text-right text-[11px] ${mine ? "text-emerald-100" : "text-slate-400"}`}>
          {source.flag} {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
