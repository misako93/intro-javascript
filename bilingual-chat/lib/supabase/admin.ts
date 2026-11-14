import { createClient } from "@supabase/supabase-js";

/**
 * Client "administrateur" (clé service_role) — SERVEUR UNIQUEMENT.
 * Contourne RLS : utilisé seulement par le webhook Stripe et l'envoi des notifications.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
