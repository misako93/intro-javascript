"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLanguage } from "@/lib/languages";
import { displayNameOf, UUID_RE } from "@/lib/utils";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/login?next=/hotel");
  return { supabase, user };
}

export async function createHotel(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const lang = formData.get("lang");
  if (!name || !isLanguage(lang)) throw new Error("Paramètres invalides");
  const { error } = await supabase.rpc("create_hotel", { p_name: name, p_lang: lang, p_display_name: displayNameOf(user) });
  if (error) throw new Error("Création impossible");
  revalidatePath("/hotel");
}

/** "101-110, 201, Suite Royale" → ["101", …, "110", "201", "Suite Royale"] */
export async function parseRoomLabels(input: string): Promise<string[]> {
  const labels: string[] = [];
  for (const raw of input.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = part.match(/^(\d{1,5})\s*[-–à]\s*(\d{1,5})$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      if (b - a > 300) continue;
      const width = range[1].length === range[2].length ? range[1].length : 0;
      for (let n = a; n <= b; n++) labels.push(width ? String(n).padStart(width, "0") : String(n));
    } else {
      labels.push(part.slice(0, 30));
    }
  }
  return [...new Set(labels)].slice(0, 500);
}

export async function addRooms(formData: FormData) {
  const { supabase } = await requireUser();
  const hotelId = String(formData.get("hotel_id") ?? "");
  if (!UUID_RE.test(hotelId)) throw new Error("Hôtel invalide");
  const labels = await parseRoomLabels(String(formData.get("rooms") ?? ""));
  if (labels.length) {
    const { error } = await supabase
      .from("hotel_rooms")
      .upsert(labels.map((label) => ({ hotel_id: hotelId, label })), { onConflict: "hotel_id,label", ignoreDuplicates: true });
    if (error) throw new Error("Ajout impossible (réservé au responsable de l’hôtel)");
  }
  revalidatePath("/hotel");
}

export async function deleteRoom(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("room_id") ?? "");
  if (UUID_RE.test(id)) await supabase.from("hotel_rooms").delete().eq("id", id);
  revalidatePath("/hotel");
}

export async function removeStaff(formData: FormData) {
  const { supabase } = await requireUser();
  const hotelId = String(formData.get("hotel_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  if (UUID_RE.test(hotelId) && UUID_RE.test(userId)) {
    await supabase.from("hotel_staff").delete().eq("hotel_id", hotelId).eq("user_id", userId);
  }
  revalidatePath("/hotel");
}

export async function updateAssistant(formData: FormData) {
  const { supabase } = await requireUser();
  const hotelId = String(formData.get("hotel_id") ?? "");
  if (!UUID_RE.test(hotelId)) throw new Error("Hôtel invalide");
  const { error } = await supabase
    .from("hotels")
    .update({
      assistant_enabled: formData.get("enabled") === "on",
      assistant_info: String(formData.get("info") ?? "").slice(0, 8000),
    })
    .eq("id", hotelId);
  if (error) throw new Error("Enregistrement impossible (réservé au responsable de l’hôtel)");
  revalidatePath("/hotel");
}
