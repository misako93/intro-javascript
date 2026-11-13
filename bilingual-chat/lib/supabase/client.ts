import { createBrowserClient } from "@supabase/ssr";

/** Client Supabase côté navigateur (singleton géré par @supabase/ssr). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
