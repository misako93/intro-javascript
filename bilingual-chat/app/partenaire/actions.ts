"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/utils";

async function requireUser(next = "/partenaire") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

export async function becomePartner(formData: FormData) {
  const { supabase } = await requireUser();
  const name = clean(formData.get("name"), 60);
  if (!name) redirect("/partenaire?erreur=nom");
  const { error } = await supabase.rpc("become_partner", { p_display_name: name, p_phone: clean(formData.get("phone"), 30) });
  if (error) redirect("/partenaire?erreur=inscription");
  revalidatePath("/partenaire");
  redirect("/partenaire");
}

/** Inscrire un hôtel : crée l'invitation (lien + QR) à faire scanner au gérant. */
export async function createHotelInvite(formData: FormData) {
  const { supabase, user } = await requireUser();
  const hotelName = clean(formData.get("hotel_name"), 80);
  if (!hotelName) redirect("/partenaire?erreur=hotel");
  const { data, error } = await supabase
    .from("hotel_invites")
    .insert({
      partner_id: user.id,
      hotel_name: hotelName,
      contact_name: clean(formData.get("contact_name"), 60),
      contact_phone: clean(formData.get("contact_phone"), 30),
    })
    .select("id")
    .single();
  if (error || !data) redirect("/partenaire?erreur=invitation");
  revalidatePath("/partenaire");
  redirect(`/partenaire/hotel/${data.id}`);
}

export async function deleteHotelInvite(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (UUID_RE.test(id)) await supabase.from("hotel_invites").delete().eq("id", id).is("claimed_at", null);
  revalidatePath("/partenaire");
  redirect("/partenaire");
}
