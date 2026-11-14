"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SECONDS } from "@/lib/config";
import { useT } from "@/components/I18n";

type Props = {
  onSendText: (text: string) => void;
  onSendAudio: (audio: Blob) => void;
  placeholder?: string;
};

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Composer({ onSendText, onSendAudio, placeholder }: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [micError, setMicError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Nettoyage si on quitte la page pendant un enregistrement
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Champ qui s'agrandit avec le texte
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Arrêt automatique (et envoi) au bout de la durée maximale
  useEffect(() => {
    if (recording && seconds >= MAX_RECORDING_SECONDS) stopRecording(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, seconds]);

  function submitText() {
    const value = text.trim();
    if (!value) return;
    onSendText(value);
    setText("");
    textareaRef.current?.focus();
  }

  async function startRecording() {
    setMicError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError(t("mic_unsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setMicError(t("mic_denied"));
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(chunksRef.current, { type });
      if (!cancelledRef.current && blob.size > 1500) onSendAudio(blob);
    };

    recorder.start(250);
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stopRecording(cancel: boolean) {
    cancelledRef.current = cancel;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return (
    <div className="border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {micError && <p className="mb-2 text-center text-sm text-red-600">{micError}</p>}

      {recording ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => stopRecording(true)}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-xl transition hover:bg-slate-200"
            aria-label={t("cancel")}
          >
            🗑️
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full bg-red-50 px-4 py-3 text-red-700">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
            <span className="font-medium">{t("recording")}</span>
            <span className="ml-auto tabular-nums">{formatDuration(seconds)}</span>
          </div>
          <button
            onClick={() => stopRecording(false)}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-700"
            aria-label={t("send")}
          >
            <SendIcon />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Entrée = envoyer (sur ordinateur), Maj+Entrée = retour à la ligne
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                submitText();
              }
            }}
            placeholder={placeholder ?? t("placeholder", { lang: "" })}
            dir="auto"
            maxLength={4000}
            className="max-h-40 min-h-12 flex-1 resize-none rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
          {text.trim() ? (
            <button
              onClick={submitText}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-700"
              aria-label={t("send")}
            >
              <SendIcon />
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-700"
              aria-label={t("record")}
              title={t("record")}
            >
              <MicIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" />
    </svg>
  );
}
