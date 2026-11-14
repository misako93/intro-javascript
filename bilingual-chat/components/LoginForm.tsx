"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GOOGLE_AUTH_ENABLED } from "@/lib/config";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setStatus("error");
      setError(
        error.status === 429
          ? "Trop de tentatives. Patientez une minute puis réessayez."
          : "Impossible d’envoyer le lien. Vérifiez votre adresse e-mail.",
      );
    } else {
      setStatus("sent");
    }
  }

  async function signInWithGoogle() {
    await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  }

  if (status === "sent") {
    return (
      <div className="text-center">
        <p className="text-5xl">📩</p>
        <h2 className="mt-4 text-lg font-semibold">Regardez vos e-mails !</h2>
        <p className="mt-2 text-slate-600">
          Nous avons envoyé un lien de connexion à <strong className="break-all">{email}</strong>.
          <br />
          Cliquez dessus et vous serez connecté·e automatiquement.
        </p>
        <p className="mt-3 text-sm text-slate-500">Rien reçu ? Pensez à regarder dans les spams.</p>
        <button onClick={() => setStatus("idle")} className="mt-6 text-sm font-medium text-emerald-700 underline">
          Changer d’adresse ou renvoyer le lien
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={sendMagicLink} className="space-y-3">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Votre adresse e-mail
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="vous@exemple.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {status === "sending" ? "Envoi en cours…" : "Recevoir mon lien de connexion"}
        </button>
        {status === "error" && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {GOOGLE_AUTH_ENABLED && (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> ou <span className="h-px flex-1 bg-slate-200" />
          </div>
          <button
            onClick={signInWithGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base font-medium text-slate-800 transition hover:bg-slate-50"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continuer avec Google
          </button>
        </>
      )}

      <p className="text-center text-xs text-slate-400">Pas de mot de passe. Pas d’inscription compliquée.</p>
    </div>
  );
}
