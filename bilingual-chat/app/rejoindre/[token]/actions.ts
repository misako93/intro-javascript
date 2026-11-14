"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLanguage } from "@/lib/languages";

/** Le gérant accepte l'invitation du partenaire : son espace hôtel est créé (ou relié). */
export async function claimInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
  const back = `/rejoindre/${token}`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect(`/login?next=${encodeURIComponent(back)}`);

  const lang = formData.get("lang");
  const { error } = await supabase.rpc("claim_hotel_invite", {
    p_token: token,
    p_name: String(formData.get("name") ?? "").trim().slice(0, 80),
    p_lang: isLanguage(lang) ? lang : "fr",
    p_display_name: String(formData.get("display_name") ?? "").trim().slice(0, 60),
  });
  if (error) {
    const code = ["already_claimed", "hotel_has_partner", "own_invite", "invalid_invite"].find((c) => error.message.includes(c));
    redirect(`${back}?erreur=${code ?? "inconnue"}`);
  }
  redirect("/hotel");
}
