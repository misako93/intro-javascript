import type { User } from "@supabase/supabase-js";

/** N'accepte que des chemins internes ("/chat/..."), jamais une URL externe. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function displayNameOf(user: User): string {
  const meta = user.user_metadata ?? {};
  const fromMeta = (meta.full_name || meta.name || "").toString().trim();
  if (fromMeta) return fromMeta.split(" ")[0];
  const local = (user.email ?? "Moi").split("@")[0].split(/[._+-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
