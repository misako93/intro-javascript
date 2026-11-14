"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLanguage } from "@/lib/languages";
import { displayNameOf } from "@/lib/utils";

export async function createRoom(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const partnerName = String(formData.get("partner_name") ?? "").trim().slice(0, 60);
  const myLang = formData.get("my_lang");
  const targetLang = formData.get("target_lang");
  if (!isLanguage(myLang) || !isLanguage(targetLang)) throw new Error("Langue invalide");

  const { data: roomId, error } = await supabase.rpc("create_room", {
    p_partner_name: partnerName || "Mon contact",
    p_my_lang: myLang,
    p_target_lang: targetLang,
    p_display_name: displayNameOf(user),
  });
  if (error || !roomId) throw new Error("Impossible de créer la conversation");

  redirect(`/chat/${roomId}`);
}
