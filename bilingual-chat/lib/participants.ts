import type { SupabaseClient } from "@supabase/supabase-js";
import type { Participant } from "@/lib/types";

/**
 * Participants d'une conversation : ses membres + l'équipe de l'hôtel (conversations d'hôtel).
 * Passe par la fonction SQL room_participants (vérifie que l'appelant y a accès).
 */
export async function getParticipants(db: SupabaseClient, roomId: string): Promise<Participant[]> {
  const { data, error } = await db.rpc("room_participants", { p_room_id: roomId });
  if (error) return [];
  return ((data ?? []) as Omit<Participant, "room_id">[]).map((p) => ({ ...p, room_id: roomId, joined_at: "" }));
}

/**
 * À qui s'adresse un message :
 * - un réceptionniste écrit → au(x) client(s) seulement (pas à ses collègues) ;
 * - un client (ou une conversation classique) → à tous les autres participants.
 */
export function recipientsOf(participants: Participant[], senderId: string) {
  const sender = participants.find((p) => p.user_id === senderId);
  return participants.filter(
    (p) => p.user_id !== senderId && (sender?.role !== "staff" || p.role === "member"),
  );
}
