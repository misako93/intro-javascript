import type { SupabaseClient } from "@supabase/supabase-js";

export type MyHotel = {
  id: string;
  name: string;
  default_lang: string;
  desk_token: string;
  staff_invite_token: string;
  role: "owner" | "staff";
};

/** L'hôtel dont l'utilisateur fait partie de l'équipe (le premier s'il y en a plusieurs). */
export async function getMyHotel(db: SupabaseClient, userId: string): Promise<MyHotel | null> {
  const { data } = await db
    .from("hotel_staff")
    .select("role, hotels(id, name, default_lang, desk_token, staff_invite_token)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const hotel = (data as { role: MyHotel["role"]; hotels: Omit<MyHotel, "role"> | null } | null)?.hotels;
  return hotel ? { ...hotel, role: (data as { role: MyHotel["role"] }).role } : null;
}
